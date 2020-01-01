Chapter 9. Disk I/O
Disk I/O is a common source of performance issues because I/O latency to a heavily loaded disk can reach tens of milliseconds or more—orders of magnitude slower than the nanosecond or microsecond speed of CPU and memory operations. Analysis with BPF tools can help find ways to tune or eliminate this disk I/O, leading to some of the largest application performance wins.

The term disk I/O refers to any storage I/O type: rotational magnetic media, flash-based storage, and network storage. These can all be exposed in Linux in the same way, as storage devices, and analyzed using the same tools.

Between an application and a storage device is usually a file system. File systems employ caching, read ahead, buffering, and asynchronous I/O to avoid blocking applications on slow disk I/O. I therefore suggest that you begin your analysis at the file system, covered in Chapter 8.

Tracing tools have already become a staple for disk I/O analysis: I wrote the first popular disk I/O tracing tools, iosnoop(8) in 2004 and iotop(8) in 2005, which are now shipped with different OSes. I also developed the BPF versions, called biosnoop(8) and biotop(8), finally adding the long-missing “b” for block device I/O. These and other disk I/O analysis tools are covered in this chapter.

Learning Objectives:

Understand the I/O stack and the role of Linux I/O schedulers

Learn a strategy for successful analysis of disk I/O performance

Identify issues of disk I/O latency outliers

Analyze multi-modal disk I/O distributions

Identify which code paths are issuing disk I/O, and their latency

Analyze I/O scheduler latency

Use bpftrace one-liners to explore disk I/O in custom ways

This chapter begins with the necessary background for disk I/O analysis, summarizing the I/O stack. I explore the questions that BPF can answer, and provide an overall strategy to follow. I then focus on tools, starting with traditional disk tools and then BPF tools, including a list of BPF one-liners. This chapter ends with optional exercises.

9.1 BACKGROUND
This section covers disk fundamentals, BPF capabilities, and a suggested strategy for disk analysis.

9.1.1 Disk Fundamentals
Block I/O Stack
The main components of the Linux block I/O stack are shown in Figure 9-1.


Figure 9-1 Linux block I/O stack

The term block I/O refers to device access in blocks, traditionally 512-byte sectors. The block device interface originated from Unix. Linux has enhanced block I/O with the addition of schedulers for improving I/O performance, volume managers for grouping multiple devices, and a device mapper for creating virtual devices.

Internals
Later BPF tools will refer to some kernel types used by the I/O stack. To introduce them here: I/O is passed through the stack as type struct request (from include/linux/blkdev.h) and, for lower levels, as struct bio (from include/linux/blk_types.h).

rwbs
For tracing observability, the kernel provides a way to describe the type of each I/O using a character string named rwbs. This is defined in the kernel blk_fill_rwbs() function and uses the characters:

R: Read

W: Write

M: Metadata

S: Synchronous

A: Read-ahead

F: Flush or force unit access

D: Discard

E: Erase

N: None

The characters can be combined. For example, “WM” is for writes of metadata.

I/O Schedulers
I/O is queued and scheduled in the block layer, either by classic schedulers (only present in Linux versions older than 5.0) or by the newer multi-queue schedulers. The classic schedulers are:

Noop: No scheduling (a no-operation)

Deadline: Enforce a latency deadline, useful for real-time systems

CFQ: The completely fair queueing scheduler, which allocates I/O time slices to processes, similar to CPU scheduling

A problem with the classic schedulers was their use of a single request queue, protected by a single lock, which became a performance bottleneck at high I/O rates. The multi-queue driver (blk-mq, added in Linux 3.13) solves this by using separate submission queues for each CPU, and multiple dispatch queues for the devices. This delivers better performance and lower latency for I/O versus classic schedulers, as requests can be processed in parallel and on the same CPU as the I/O was initiated. This was necessary to support flash memory-based and other device types capable of handling millions of IOPS [90].

Multi-queue schedulers available include:

None: No queueing

BFQ: The budget fair queueing scheduler, similar to CFQ, but allocates bandwidth as well as I/O time

mq-deadline: A blk-mq version of deadline

Kyber: A scheduler that adjusts read and write dispatch queue lengths based on performance, so that target read or write latencies can be met

The classic schedulers and the legacy I/O stack were removed in Linux 5.0. All schedulers are now multi-queue.

Disk I/O Performance
Figure 9-2 shows a disk I/O with operating system terminology.


Figure 9-2 Disk I/O

From the operating system, wait time is the time spent in the block layer scheduler queues and device dispatcher queues. Service time is the time from device issue to completion. This may include time spent waiting on an on-device queue. Request time is the overall time from when an I/O was inserted into the OS queues to its completion. The request time matters the most, as that is the time that applications must wait if I/O is synchronous.

A metric not included in this diagram is disk utilization. It may seem ideal for capacity planning: when a disk approaches 100% utilization, you may assume there is a performance problem. However, utilization is calculated by the OS as the time that disk was doing something, and does not account for virtual disks that may be backed by multiple devices, or on-disk queues. This can make the disk utilization metric misleading in some situations, including when a disk at 90% may be able to accept much more than an extra 10% of workload. Utilization is still useful as a clue, and is a readily available metric. However, saturation metrics, such as time spent waiting, are better measures of disk performance problems.

9.1.2 BPF Capabilities
Traditional Performance tools provide some insight for storage I/O, including IOPS rates, average latency and queue lengths, and I/O by process. These traditional tools are summarized in the next section.

BPF tracing tools can provide additional insight for disk activity, answering:

What are the disk I/O requests? What type, how many, and what I/O size?

What were the request times? Queued times?

Were there latency outliers?

Is the latency distribution multi-modal?

Were there any disk errors?

What SCSI commands were sent?

Were there any timeouts?

To answer these, trace I/O throughout the block I/O stack.

Event Sources
Table 9-1 lists the event sources for instrumenting disk I/O.

Table 9-1 Event Sources for Instrumenting Disk I/O

Event Type

Event Source

Block interface and block layer I/O

block tracepoints, kprobes

I/O scheduler events

kprobes

SCSI I/O

scsi tracepoints, kprobes

Device driver I/O

kprobes

These provide visibility from the block I/O interface down to the device driver.

As an example event, here are the arguments to block:block_rq_issue, which sends a block I/O to a device:

Click here to view code image


# bpftrace -lv tracepoint:block:block_rq_issue
tracepoint:block:block_rq_issue
    dev_t dev;
    sector_t sector;
    unsigned int nr_sector;
    unsigned int bytes;
    char rwbs[8];
    char comm[16];
    __data_loc char[] cmd;

Questions such as “what are the I/O sizes for requests?” can be answered via a one-liner using this tracepoint:

Click here to view code image

bpftrace -e 'tracepoint:block:block_rq_issue { @bytes = hist(args->bytes); }'
Combinations of tracepoints allow the time between events to be measured.

9.1.3 Strategy
If you are new to disk I/O analysis, here is a suggested overall strategy that you can follow. The next sections explain these tools in more detail.

For application performance issues, begin with file system analysis, covered in Chapter 8.

Check basic disk metrics: request times, IOPS, and utilization (e.g., iostat(1)). Look for high utilization (which is a clue) and higher-than-normal request times (latency) and IOPS.

If you are unfamiliar with what IOPS rates or latencies are normal, use a microbenchmark tool such as fio(1) on an idle system with some known workloads and run iostat(1) to examine them.

Trace block I/O latency distributions and check for multi-modal distributions and latency outliers (e.g., using BCC biolatency(8)).

Trace individual block I/O and look for patterns such as reads queueing behind writes (you can use BCC biosnoop(8)).

Use other tools and one-liners from this chapter.

To explain that first step some more: if you begin with disk I/O tools, you may quickly identify cases of high latency, but the question then becomes: how much does this matter? I/O may be asynchronous to the application. If so, that’s interesting to analyze, but for different reasons: understanding contention with other synchronous I/O, and device capacity planning.

9.2 TRADITIONAL TOOLS
This section covers iostat(1) for disk activity summaries, perf(1) for block I/O tracing, blktrace(8), and the SCSI log.

9.2.1 iostat
iostat(1) summarizes per-disk I/O statistics, providing metrics for IOPS, throughput, I/O request times, and utilization. It can be executed by any user, and is typically the first command used to investigate disk I/O issues at the command line. The statistics it sources are maintained by the kernel by default, so the overhead of this tool is considered negligible.

iostat(1) provides many options for customizing the output. A useful combination is -dxz 1, to show disk utilization only (-d), extended columns (-x), skipping devices with zero metrics (-z), and per-second output (1). The output is so wide that I’ll show a left portion and then the right portion; this is from a production issue I helped debug:

Click here to view code image


# iostat -dxz 1
Linux 4.4.0-1072-aws (...)      12/18/2018      _x86_64_        (16 CPU)

Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s    wkB/s \ ...
xvda              0.00     0.29    0.21    0.17     6.29     3.09 / ...
xvdb              0.00     0.08   44.39    9.98  5507.39  1110.55 \ ...
                                                                  / ...
Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s    wkB/s \ ...
xvdb              0.00     0.00  745.00    0.00 91656.00     0.00 / ...
                                                                  \ ...
Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s    wkB/s / ...
xvdb              0.00     0.00  739.00    0.00 92152.00     0.00 \ ...

These columns summarize the workload applied, and are useful for workload characterization. The first two provide insight into disk merges: this is where a new I/O is found to be reading or writing to a disk location adjacent (front or back) to another queued I/O, so they are merged for efficiency.

The columns are:

rrqm/s: Read requests queued and merged per second

wrqm/s: Write requests queued and merged per second

r/s: Read requests completed per second (after merges)

w/s: Write requests completed per second (after merges)

rkB/s: Kbytes read from the disk device per second

wkB/s: Kbytes written to the disk device per second

The first group of output (showing both xvda and xvdb devices) is the summary since boot, and can be used for comparison with the subsequent one-second summaries. This output shows that xvdb normally has a read throughput of 5,507 Kbytes/sec, but the current one-second summaries show over 90,000 read Kbytes/sec. The system has a heavier-than-normal read workload.

Some math can be applied to these columns to figure out the average read and write size. Dividing the rkB/s column by the r/s column shows the average read size is about 124 Kbytes. A newer version of iostat(1) includes average sizes as the rareq-sz (read average request size) and wareq-sz columns.

The right columns show:

Click here to view code image


... \ avgrq-sz avgqu-sz   await r_await w_await  svctm  %util
... /    49.32     0.00   12.74    6.96   19.87   3.96   0.15
... \   243.43     2.28   41.96   41.75   42.88   1.52   8.25
... /
... \ avgrq-sz avgqu-sz   await r_await w_await  svctm  %util
... /   246.06    25.32   33.84   33.84    0.00   1.35 100.40
... \
... / avgrq-sz avgqu-sz   await r_await w_await  svctm  %util
... \   249.40    24.75   33.49   33.49    0.00   1.35 100.00

These show the resulting performance by the device. The columns are:

avgrq-sz: Average request size in sectors (512 bytes).

avgqu-sz: Average number of requests both waiting in the driver request queue and active on the device.

await: Average I/O request time (aka response time), including time waiting in the driver request queue and the I/O response time of the device (ms).

r_await: Same as await, but for reads only (ms).

w_await: Same as await, but for writes only (ms).

svctm: Average (inferred) I/O response time for the disk device (ms).

%util: Percentage of time device was busy processing I/O requests (utilization).

The most important metric for delivered performance is await. If the application and file system use a technique to mitigate write latency (e.g., write through), then w_await may not matter as much, and you can focus on r_await instead.

For resource usage and capacity planning, %util is important, but keep in mind that it is only a measure of busy-ness (non-idle time), and may mean little for virtual devices backed by multiple disks. Those devices may be better understood by the load applied: IOPS (r/s + w/s) and throughput (rkB/s + wkB/s).

This example output shows the disk hitting 100% utilization, and an average read I/O time of 33 milliseconds. For the workload applied and the disk device, this turned out to be expected performance. The real issue was that the files being read had become so large they could no longer be cached in the page cache, and were read from disk instead.

9.2.2 perf
perf(1) was introduced in Chapter 6 for PMC analysis and timed stack sampling. Its tracing capabilities can also be used for disk analysis, especially using the block tracepoints.

For example, tracing the queuing of requests (block_rq_insert), their issue to a storage device (block_rq_issue), and their completions (block_rq_complete):

Click here to view code image


# perf record -e block:block_rq_insert,block:block_rq_issue,block:block_rq_complete -a
^C[ perf record: Woken up 7 times to write data ]
[ perf record: Captured and wrote 6.415 MB perf.data (20434 samples) ]
# perf script
    kworker/u16:3 25003 [004] 543348.164811:   block:block_rq_insert: 259,0 RM 4096 ()
2564656 + 8 [kworker/u16:3]
    kworker/4:1H    533 [004] 543348.164815:   block:block_rq_issue: 259,0 RM 4096 ()
2564656 + 8 [kworker/4:1H]
         swapper      0 [004] 543348.164887:   block:block_rq_complete: 259,0 RM ()
2564656 + 8 [0]
   kworker/u17:0 23867  [005] 543348.164960:   block:block_rq_complete: 259,0 R ()
3190760 + 256 [0]
              dd 25337  [001] 543348.165046:   block:block_rq_insert: 259,0 R 131072 ()
3191272 + 256 [dd]
              dd 25337  [001] 543348.165050:   block:block_rq_issue: 259,0 R 131072 ()
3191272 + 256 [dd]
              dd 25337  [001] 543348.165111:   block:block_rq_complete: 259,0 R ()
3191272 + 256 [0]
[...]

The output contains many details, beginning with the process that was on-CPU when the event occurred, which may or may not be the process responsible for the event. Other details include a timestamp, disk major and minor numbers, a string encoding the type of I/O (rwbs, described earlier), and other details about the I/O.

I have in the past built tools that post-process these events for calculating latency histograms, and visualizing access patterns.1 However, for busy systems this means dumping all block events to user space for post-processing. BPF can do this processing in the kernel more efficiently, and then emit only the desired output. See the later biosnoop(8) tool as an example.

1 See iolatency(8) in perf-tools [78]: this uses Ftrace to access the same per-event tracepoint data from the trace buffer, which avoids the overhead of creating and writing a perf.data file.

9.2.3 blktrace
blktrace(8) is a specialized utility for tracing block I/O events. Using its btrace(8) front-end to trace all events:

Click here to view code image


# btrace /dev/nvme2n1
259,0    2        1     0.000000000   430  Q  WS 2163864 + 8 [jbd2/nvme2n1-8]
259,0    2        2     0.000009556   430  G  WS 2163864 + 8 [jbd2/nvme2n1-8]
259,0    2        3     0.000011109   430  P   N [jbd2/nvme2n1-8]
259,0    2        4     0.000013256   430  Q  WS 2163872 + 8 [jbd2/nvme2n1-8]
259,0    2        5     0.000015740   430  M  WS 2163872 + 8 [jbd2/nvme2n1-8]
[...]
259,0    2       15     0.000026963   430  I  WS 2163864 + 48 [jbd2/nvme2n1-8]
259,0    2       16     0.000046155   430  D  WS 2163864 + 48 [jbd2/nvme2n1-8]
259,0    2       17     0.000699822   430  Q  WS 2163912 + 8 [jbd2/nvme2n1-8]
259,0    2       18     0.000701539   430  G  WS 2163912 + 8 [jbd2/nvme2n1-8]
259,0    2       19     0.000702820   430  I  WS 2163912 + 8 [jbd2/nvme2n1-8]
259,0    2       20     0.000704649   430  D  WS 2163912 + 8 [jbd2/nvme2n1-8]
259,0   11        1     0.000664811     0  C  WS 2163864 + 48 [0]
259,0   11        2     0.001098435     0  C  WS 2163912 + 8 [0]
[...]

Multiple event lines are printed for each I/O. The columns are:

Device major, minor number

CPU ID

Sequence number

Action time, in seconds

Process ID

Action identifier (see blkparse(1)): Q == queued, G == get request, P == plug, M == merge, D == issued, C == completed, etc.

RWBS description (see the “rwbs” section earlier in this chapter): W == write, S == synchronous, etc.

Address + size [device]

The output can be post-processed and visualized using Chris Mason’s seekwatcher [91].

As with perf(1) per-event dumping, the overhead of blktrace(8) can be a problem for busy disk I/O workloads. In-kernel summaries using BPF can greatly reduce this overhead.

9.2.4 SCSI Logging
Linux also has a built-in facility for SCSI event logging. It can be enabled via sysctl(8) or /proc. For example, both of these commands set the logging to the maximum for all event types (warning: depending on your disk workload, this may flood your system log):

Click here to view code image


# sysctl w dev.scsi.logging_level=0x1b6db6db
# echo 0x1b6db6db > /proc/sys/dev/scsi/logging_level

The format of the number is a bitfield that sets the logging level from 1 to 7 for 10 different event types. It is defined in drivers/scsi/scsi_logging.h. The sg3utils package provides a scsi_logging_level(8) tool for setting these. For example:

Click here to view code image

scsi_logging_level -s --all 3
Example events:

Click here to view code image


# dmesg
[...]
[542136.259412] sd 0:0:0:0: tag#0 Send: scmd 0x0000000001fb89dc
[542136.259422] sd 0:0:0:0: tag#0 CDB: Test Unit Ready 00 00 00 00 00 00
[542136.261103] sd 0:0:0:0: tag#0 Done: SUCCESS Result: hostbyte=DID_OK driverbyte=DRIVER_OK
[542136.261110] sd 0:0:0:0: tag#0 CDB: Test Unit Ready 00 00 00 00 00 00
[542136.261115] sd 0:0:0:0: tag#0 Sense Key : Not Ready [current]
[542136.261121] sd 0:0:0:0: tag#0 Add. Sense: Medium not present
[542136.261127] sd 0:0:0:0: tag#0 0 sectors total, 0 bytes done.
[...]

This can be used to help debug errors and timeouts. While timestamps are provided (the first column), using them to calculate I/O latency is difficult without unique identifying details.

BPF tracing can be used to produce custom SCSI-level and other I/O stack-level logs, with more I/O details including latency calculated in the kernel.

9.3 BPF TOOLS
This section covers the BPF tools you can use for disk performance analysis and troubleshooting. They are shown in Figure 9-3.


Figure 9-3 BPF tools for disk analysis

These tools are either from the BCC and bpftrace repositories covered in Chapters 4 and 5, or were created for this book. Some tools appear in both BCC and bpftrace. Table 9-2 lists the origins of the tools covered in this section (BT is short for bpftrace).

Table 9-2 Disk-Related Tools

Tool

Source

Target

Description

biolatency

BCC/BT

Block I/O

Summarize block I/O latency as a histogram

biosnoop

BCC/BT

Block I/O

Trace block I/O with PID and latency

biotop

BCC

Block I/O

Top for disks: summarize block I/O by process

bitesize

BCC/BT

Block I/O

Show disk I/O size histogram by process

seeksize

Book

Block I/O

Show requested I/O seek distances

biopattern

Book

Block I/O

Identify random/sequential disk access patterns

biostacks

Book

Block I/O

Show disk I/O with initialization stacks

bioerr

Book

Block I/O

Trace disk errors

mdflush

BCC/BT

MD

Trace md flush requests

iosched

Book

I/O sched

Summarize I/O scheduler latency

scsilatency

Book

SCSI

Show SCSI command latency distributions

scsiresult

Book

SCSI

Show SCSI command result codes

nvmelatency

Book

NVME

Summarize NVME driver command latency

For the tools from BCC and bpftrace, see their repositories for full and updated lists of tool options and capabilities. A selection of the most important capabilities are summarized here. See Chapter 8 for file system tools.

9.3.1 biolatency
biolatency(8)2 is a BCC and bpftrace tool to show block I/O device latency as a histogram. The term device latency refers to the time from issuing a request to the device, to when it completes, including time spent queued in the operating system.

2 Origin: I created this as iolatency.d for the 2011 DTrace book [Gregg 11], following the same name as my other iosnoop and iotop tools. This led to confusion since “io” is ambiguous, so for BPF I’ve added the “b” to these tools to signify block I/O. I created biolatency for BCC on 20-Sep-2015 and bpftrace on 13-Sep-2018.

The following shows biolatency(8) from BCC, on a production Hadoop instance, tracing block I/O for 10 seconds:

Click here to view code image


# biolatency 10 1
Tracing block device I/O... Hit Ctrl-C to end.

     usecs               : count      distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 0        |                                        |
        32 -> 63         : 0        |                                        |
        64 -> 127        : 15       |                                        |
       128 -> 255        : 4475     |************                            |
       256 -> 511        : 14222    |****************************************|
       512 -> 1023       : 12303    |**********************************      |
      1024 -> 2047       : 5649     |***************                         |
      2048 -> 4095       : 995      |**                                      |
      4096 -> 8191       : 1980     |*****                                   |
      8192 -> 16383      : 3681     |**********                              |
     16384 -> 32767      : 1895     |*****                                   |
     32768 -> 65535      : 721      |**                                      |
     65536 -> 131071     : 394      |*                                       |
    131072 -> 262143     : 65       |                                        |
    262144 -> 524287     : 17       |                                        |

This output shows a bi-modal distribution, with one mode between 128 and 2047 microseconds and the other between about 4 and 32 milliseconds. Now that I know that the device latency is bi-modal, understanding why may lead to tuning that moves more I/O to the faster mode. For example, the slower I/O could be random I/O, or larger-size I/O (which can be determined using other BPF tools). The slowest I/O in this output reached the 262- to 524-millisecond range: this sounds like deep queueing on the device.

biolatency(8) and the later biosnoop(8) tool have been used to solve many production issues. They can be especially useful for the analysis of multi-tenant drives in cloud environments, which can be noisy and break latency SLOs. When running on small cloud instances, Netflix’s Cloud Database team was able to use biolatency(8) and biosnoop(8) to isolate machines with unacceptably bi-modal or latent drives, and evict them from both distributed caching tiers and distributed database tiers. Upon further analysis, the team decided to change their deployment strategy based on these findings, and now deploy clusters to fewer nodes, choosing those large enough to have dedicated drives. This small change effectively eliminated the latency outliers with no additional infrastructure cost.

The biolatency(8) tool currently works by tracing various block I/O kernel functions using kprobes. It was written before tracepoint support was available in BCC, so used kprobes instead. The overhead of this tool should be negligible on most systems where the disk IOPS rate is low (<1000).

Queued Time
BCC biolatency(8) has a -Q option to include the OS queued time:

Click here to view code image


# biolatency -Q 10 1
Tracing block device I/O... Hit Ctrl-C to end.

     usecs               : count      distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 0        |                                        |
        32 -> 63         : 0        |                                        |
        64 -> 127        : 1        |                                        |
       128 -> 255        : 2780     |**********                              |
       256 -> 511        : 10386    |****************************************|
       512 -> 1023       : 8399     |********************************        |
      1024 -> 2047       : 4154     |***************                         |
      2048 -> 4095       : 1074     |****                                    |
      4096 -> 8191       : 2078     |********                                |
      8192 -> 16383      : 7688     |*****************************           |
     16384 -> 32767      : 4111     |***************                         |
     32768 -> 65535      : 818      |***                                     |
     65536 -> 131071     : 220      |                                        |
    131072 -> 262143     : 103      |                                        |
    262144 -> 524287     : 48       |                                        |
    524288 -> 1048575    : 6        |                                        |

The output is not much different: this time there’s some more I/O in the slower mode. iostat(1) confirms that the queue lengths are small (avgqu-sz < 1).

Disks
Systems can have mixed storage devices: disks for the OS, disks for storage pools, and drives for removable media. The -D option in biolatency(8) shows histograms for disks separately, helping you see how each type performs. For example:

Click here to view code image


# biolatency -D
Tracing block device I/O... Hit Ctrl-C to end.
^C
[...]
disk = 'sdb'
     usecs               : count      distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 0        |                                        |
        32 -> 63         : 0        |                                        |
        64 -> 127        : 0        |                                        |
       128 -> 255        : 1        |                                        |
       256 -> 511        : 25       |**                                      |
       512 -> 1023       : 43       |****                                    |
      1024 -> 2047       : 206      |*********************                   |
      2048 -> 4095       : 8        |                                        |
      4096 -> 8191       : 8        |                                        |
      8192 -> 16383      : 392      |****************************************|

disk = 'nvme0n1'
     usecs               : count      distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 12       |                                        |
        16 -> 31         : 72       |                                        |
        32 -> 63         : 5980     |****************************************|
        64 -> 127        : 1240     |********                                |
       128 -> 255        : 74       |                                        |
       256 -> 511        : 13       |                                        |
       512 -> 1023       : 4        |                                        |
      1024 -> 2047       : 23       |                                        |
      2048 -> 4095       : 10       |                                        |
      4096 -> 8191       : 63       |                                        |

This output shows two very different disk devices: nvme0n1, a flash-memory based disk, with I/O latency often between 32 and 127 microseconds; and sdb, an external USB storage device, with a bimodal I/O latency distribution in the milliseconds.

Flags
BCC biolatency(8) also has a -F option to print each set of I/O flags differently. For example, with -m for millisecond histograms:

Click here to view code image


# biolatency -Fm
Tracing block device I/O... Hit Ctrl-C to end.
^C

[...]

flags = Read
     msecs               : count      distribution
         0 -> 1          : 180      |*************                           |
         2 -> 3          : 519      |****************************************|
         4 -> 7          : 60       |****                                    |
         8 -> 15         : 123      |*********                               |
        16 -> 31         : 68       |*****                                   |
        32 -> 63         : 0        |                                        |
        64 -> 127        : 2        |                                        |
       128 -> 255        : 12       |                                        |
       256 -> 511        : 0        |                                        |
       512 -> 1023       : 1        |                                        |

flags = Sync-Write
     msecs               : count      distribution
         0 -> 1          : 8        |***                                     |
         2 -> 3          : 26       |***********                             |
         4 -> 7          : 37       |***************                         |
         8 -> 15         : 65       |***************************             |
        16 -> 31         : 93       |****************************************|
        32 -> 63         : 20       |********                                |
        64 -> 127        : 6        |**                                      |
       128 -> 255        : 0        |                                        |
       256 -> 511        : 4        |*                                       |
       512 -> 1023       : 17       |*******                                 |

flags = Flush
     msecs               : count      distribution
         0 -> 1          : 2        |****************************************|

flags = Metadata-Read
     msecs               : count      distribution
         0 -> 1          : 3        |****************************************|
         2 -> 3          : 2        |**************************              |
         4 -> 7          : 0        |                                        |
         8 -> 15         : 1        |*************                           |
        16 -> 31         : 1        |*************                           |

These flags may be handled differently by the storage device; separating them allows us to study them in isolation. The above output shows that synchronous writes are bi-modal, with a slower mode in the 512- to 1023-millisecond range.

These flags are also visible in the block tracepoints via the rwbs field and one-letter encodings: see the “rwbs” section, earlier in this chapter, for an explanation of this field.

BCC
Command line usage:

Click here to view code image

biolatency [options] [interval [count]]
Options include:

-m: Print output in milliseconds (default is microseconds)

-Q: Include OS queued time

-D: Show each disk separately

-F: Show each set of I/O flags separately

-T: Include a timestamp on the output

Using an interval of one will print per-second histograms. This information can be visualized as a latency heat map, with a full second as columns, latency ranges as rows, and a color saturation to show the number of I/O in that time range [Gregg 10]. See Chapter 17 for an example using Vector.

bpftrace
The following is the code for the bpftrace version, which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing block device I/O... Hit Ctrl-C to end.\n");
}

kprobe:blk_account_io_start
{
        @start[arg0] = nsecs;
}

kprobe:blk_account_io_done
/@start[arg0]/
{
        @usecs = hist((nsecs - @start[arg0]) / 1000);
        delete(@start[arg0]);
}

END
{
        clear(@start);
}

This tool needs to store a timestamp at the start of each I/O to record its duration (latency). However, multiple I/O can be in flight concurrently. A single global timestamp variable would not work: a timestamp must be associated with each I/O. In many other BPF tools, this is solved by storing timestamps in a hash with the thread ID as a key. This does not work with disk I/O, since disk I/O can initiate on one thread and complete on another, in which case the thread ID changes. The solution used here is to take arg0 of these functions, which is the address of the struct request for the I/O, and use that memory address as the hash key. So long as the kernel does not change the memory address between issue and completion, it is suitable as the unique ID.

Tracepoints
The BCC and bpftrace versions of biolatency(8) should use the block tracepoints where possible, but there is a challenge: the struct request pointer is not currently available in the tracepoint arguments, so another key must be used to uniquely identify the I/O. One approach is to use the device ID and sector number. The core of the program can be changed to the following (biolatency-tp.bt):

Click here to view code image


[...]
tracepoint:block:block_rq_issue
{
        @start[args->dev, args->sector] = nsecs;
}

tracepoint:block:block_rq_complete
/@start[args->dev, args->sector]/
{
        @usecs = hist((nsecs - @start[args->dev, args->sector]) / 1000);
        delete(@start[args->dev, args->sector]);
}
[...]

This assumes that there is not multiple concurrent I/O to the same device and sector. This is measuring the device time, not including the OS queued time.

9.3.2 biosnoop
biosnoop(8)3 is a BCC and bpftrace tool that prints a one-line summary for each disk I/O. The following shows biosnoop(8) from BCC, running on a Hadoop production instance:

3 Origin: While I was a sysadmin at the University of Newcastle, Australia, in 2000, a shared server was suffering slow disk performance, which was suspected to be caused by a researcher running a batch job. They refused to move their workload unless I could prove that they were causing the heavy disk I/O, but no tool could do this. A workaround concocted either by me or the senior admin, Doug Scott, was to SIGSTOP their process while watching iostat(1), then SIGCONT it a few seconds later: the dramatic drop in disk I/O proved that they were responsible. Wanting a less invasive method, I saw the Sun TNF/prex tracing utility in Adrian Cockcroft’s Sun Performance and Tuning book [Cockcroft 98], and on 3-Dec-2003 I created psio(1M), a utility to print disk I/O by process [185], which also had a mode to trace per-event disk I/O. DTrace was made available in beta in the same month, and I eventually rewrote my disk I/O tracer as iosnoop(1M) on 12-Mar-2004, initially before there was an io provider. I was quoted in The Register’s DTrace announcement talking about this work [Vance 04]. I created the BCC version as biosnoop(8) on 16-Sep-2015, and the bpftrace version on 15-Nov-2017.

Click here to view code image


# biosnoop
TIME(s)     COMM           PID    DISK    T SECTOR     BYTES    LAT(ms)
0.000000    java           5136   xvdq    R 980043184  45056      0.35
0.000060    java           5136   xvdq    R 980043272  45056      0.40
0.000083    java           5136   xvdq    R 980043360  4096       0.42
[...]
0.143724    java           5136   xvdy    R 5153784    45056      1.08
0.143755    java           5136   xvdy    R 5153872    40960      1.10
0.185374    java           5136   xvdm    R 2007186664 45056      0.34
0.189267    java           5136   xvdy    R 979232832  45056     14.00
0.190330    java           5136   xvdy    R 979232920  45056     15.05
0.190376    java           5136   xvdy    R 979233008  45056     15.09
0.190403    java           5136   xvdy    R 979233096  45056     15.12
0.190409    java           5136   xvdy    R 979233184  45056     15.12
0.190441    java           5136   xvdy    R 979233272  36864     15.15
0.190176    java           5136   xvdm    R 2007186752 45056      5.13
0.190231    java           5136   xvdm    R 2007186840 45056      5.18
[...]

This output shows Java with PID 5136 doing reads to different disks. There were six reads with latency of around 15 milliseconds. If you look closely at the TIME(s) column, which shows the I/O completion time, these all finished within a fraction of a millisecond and were to the same disk (xvdy). You can conclude that these were queued together: the latency creeping up from 14.00 to 15.15 milliseconds is another clue to queued I/O being completed in turn. The sector offsets are also contiguous: 45056 byte reads are 88 × 512-byte sectors.

As an example of production use: teams at Netflix that run stateful services routinely use biosnoop(8) to isolate issues with read-ahead degrading the performance of I/O-intensive workloads. Linux tries to intelligently read ahead data into the OS page cache, but this can cause severe performance issues for data stores running on fast solid-state drives, especially with the default read ahead settings. After identifying aggressive read-ahead, these teams then perform targeted refactors by analyzing histograms of I/O size and latency organized by thread, and then improve performance by using an appropriate madvise option, direct I/O, or changing the default read-ahead to smaller values such as 16 Kbytes. For histograms of I/O sizes, see vfssize(8) from Chapter 8 and bitesize(8) from this chapter; also see the readahead(8) tool in Chapter 8, which was created more recently for the analysis of this issue.

The biostoop(8) columns are:

TIME(s): I/O completion time in seconds

COMM: Process name, if cached

PID: Process ID, if cached

DISK: Storage device name

T: Type: R == reads, W == writes

SECTOR: Address on disk in units of 512-byte sectors

BYTES: Size of the I/O

LAT(ms): Duration of the I/O from device issue to device completion

This works in the same way as biolatency(8): tracing kernel block I/O functions. A future version should switch to the block tracepoints. The overhead of this tool is a little higher than biolatency(8) as it is printing per-event output.

OS Queued Time
A -Q option to BCC biosnoop(8) can be used to show the time spent between the creation of the I/O and the issue to the device: this time is mostly spent on OS queues, but could also include memory allocation and lock acquisition. For example:

Click here to view code image


# biosnoop -Q
TIME(s)     COMM           PID    DISK    T SECTOR     BYTES  QUE(ms) LAT(ms)
19.925329   cksum          20405  sdb     R 249631     16384    17.17    1.63
19.933890   cksum          20405  sdb     R 249663     122880   17.81    8.51
19.942442   cksum          20405  sdb     R 249903     122880   26.35    8.51
19.944161   cksum          20405  sdb     R 250143     16384    34.91    1.66
19.952853   cksum          20405  sdb     R 250175     122880   15.53    8.59
[...]

The queued time is shown in the QUE(ms) column. This example of high queue times for reads was from a USB flash drive using the CFQ I/O scheduler. Write I/O queues even more:

Click here to view code image


# biosnoop -Q
TIME(s)     COMM           PID    DISK    T SECTOR     BYTES  QUE(ms) LAT(ms)
[...]
2.338149    ?              0              W 0          8192      0.00    2.72
2.354710    ?              0              W 0          122880    0.00   16.17
2.371236    kworker/u16:1  18754  sdb     W 486703     122880 2070.06   16.51
2.387687    cp             20631  nvme0n1 R 73365192   262144    0.01    3.23
2.389213    kworker/u16:1  18754  sdb     W 486943     122880 2086.60   17.92
2.404042    kworker/u16:1  18754  sdb     W 487183     122880 2104.53   14.81
2.421539    kworker/u16:1  18754  sdb     W 487423     122880 2119.40   17.43
[...]

The queue time for writes exceeds two seconds. Note that earlier I/O lacked most of the column details: they were enqueued before tracing began, and so biosnoop(8) missed caching those details and only shows the device latency.

BCC
Command line usage:

biosnoop [options]
Options include -Q for OS queued time.

bpftrace
The following is the code for the bpftrace version, which traces the full duration of the I/O, including queued time:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("%-12s %-16s %-6s %7s\n", "TIME(ms)", "COMM", "PID", "LAT(ms)");
}

kprobe:blk_account_io_start
{
        @start[arg0] = nsecs;
        @iopid[arg0] = pid;
        @iocomm[arg0] = comm;
}

kprobe:blk_account_io_done
/@start[arg0] != 0 && @iopid[arg0] != 0 && @iocomm[arg0] != ""/
{
        $now = nsecs;
        printf("%-12u %-16s %-6d %7d\n",
            elapsed / 1000000, @iocomm[arg0], @iopid[arg0],
            ($now - @start[arg0]) / 1000000);

        delete(@start[arg0]);
        delete(@iopid[arg0]);
        delete(@iocomm[arg0]);
}

END
{
        clear(@start);
        clear(@iopid);
        clear(@iocomm);
}

The blk_account_io_start() function often fires in process context and occurs when the I/O is queued. Later events, such as issuing the I/O to the device and I/O completion, may or may not happen in process context, so you cannot rely on the value of the pid and comm builtins at those later times. The solution is to store them in BPF maps during blk_account_io_start(), keyed by the request ID, so that they can be retrieved later.

As with biolatency(8), this tool can be rewritten to use the block tracepoints (see Section 9.5).

9.3.3 biotop
biotop(8)4 is a BCC tool that is top(1) for disks. The following shows it running on a production Hadoop instance, with -C to not clear the screen between updates:

4 Origin: I created the first iotop using DTrace on 15-Jul-2005, and wrote this BCC version 6-Feb-2016. These were inspired by top(1) by William LeFebvre.

Click here to view code image


# biotop -C
Tracing... Output every 1 secs. Hit Ctrl-C to end
06:09:47 loadavg: 28.40 29.00 28.96 44/3812 124008

PID    COMM             D MAJ MIN  DISK       I/O  Kbytes  AVGms
123693 kworker/u258:0   W 202 4096 xvdq      1979   86148   0.93
55024  kworker/u257:8   W 202 4608 xvds      1480   64068   0.73
123693 kworker/u258:0   W 202 5376 xvdv       143    5700   0.52
5381   java             R 202 176  xvdl        81    3456   3.01
43297  kworker/u257:0   W 202 80   xvdf        48    1996   0.56
5383   java             R 202 112  xvdh        27    1152  16.05
5383   java             R 202 5632 xvdw        27    1152   3.45
5383   java             R 202 224  xvdo        27    1152   6.79
5383   java             R 202 96   xvdg        24    1024   0.52
5383   java             R 202 192  xvdm        24    1024  39.45
5383   java             R 202 5888 xvdx        24    1024   0.64
5383   java             R 202 5376 xvdv        24    1024   4.74
5383   java             R 202 4096 xvdq        24    1024   3.07
5383   java             R 202 48   xvdd        24    1024   0.62
5383   java             R 202 5120 xvdu        24    1024   4.20
5383   java             R 202 208  xvdn        24    1024   2.54
5383   java             R 202 80   xvdf        24    1024   0.66
5383   java             R 202 64   xvde        24    1024   8.08
5383   java             R 202 32   xvdc        24    1024   0.63
5383   java             R 202 160  xvdk        24    1024   1.42
[...]

This shows that a Java process is reading from many different disks. Top of the list are kworker threads initiating writes: this is background write flushing, and the real process that dirtied the pages is not known at this point (it can be identified using the file system tools from Chapter 8).

This works using the same events as biolatency(8), with similar overhead expectations.

Command line usage:

Click here to view code image

biotop [options] [interval [count]]
Options include:

-C: Don’t clear the screen

-r ROWS: Number of rows to print

The output is truncated to 20 rows by default, which can be tuned with -r.

9.3.4 bitesize
bitesize(8)5 is a BCC and bpftrace tool to show the size of disk I/O. The following shows the BCC version running on a production Hadoop instance:

5 Origin: I first created this as bitesize.d using DTrace on 31-Mar-2004, before the io provider was available. Allan McAleavy created the BCC version on 5-Feb-2016, and I created the bpftrace one on 7-Sep-2018.

Click here to view code image


# bitesize
Tracing... Hit Ctrl-C to end.
^C
[...]

Process Name = kworker/u257:10
     Kbytes              : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 17       |                                        |
         8 -> 15         : 12       |                                        |
        16 -> 31         : 79       |*                                       |
        32 -> 63         : 3140     |****************************************|

Process Name = java
     Kbytes              : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 3        |                                        |
         4 -> 7          : 60       |                                        |
         8 -> 15         : 68       |                                        |
        16 -> 31         : 220      |**                                      |
        32 -> 63         : 3996     |****************************************|

This output shows that both the kworker thread and java are calling I/O mostly in the 32- to 63-Kbyte range. Checking the I/O size can lead to optimizations:

Sequential workloads should try the largest possible I/O size for peak performance. Larger sizes sometimes encounter slightly worse performance; there may be a sweet spot (e.g., 128 Kbytes) based on memory allocators and device logic.

Random workloads should try to match the I/O size with the application record size. Larger I/O sizes pollute the page cache with data that isn’t needed; smaller I/O sizes result in more I/O overhead than needed.

This works by instrumenting the block:block_rq_issue tracepoint.

BCC
bitesize(8) currently does not support options.

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing block device I/O... Hit Ctrl-C to end.\n");
}

tracepoint:block:block_rq_issue
{
        @[args->comm] = hist(args->bytes);
}

END
{
        printf("\nI/O size (bytes) histograms by process name:");
}

The tracepoint provides the process name as args->comm, and the size as args->bytes. This insert tracepoint fires when the request is inserted on the OS queue. Later tracepoints such as completion do not provide args->comm, nor can the comm builtin be used, as they fire asynchronously to the process (e.g., on device completion interrupt).

9.3.5 seeksize
seeksize(8)6 is a bpftrace tool to show how many sectors that processes are requesting the disks to seek. This is only a problem for rotational magnetic media,7 where the drive heads must physically move from one sector offset to another, causing latency. Example output:

6 Origin: I first created it as seeksize.d using DTrace on 11-Sep-2004, as seek issues on rotational disks were common at the time. I created the bpftrace version it for a blog post on 18-Oct-2018 and revised it for this book on 20-Mar-2019.

7 Almost. Flash drives have their flash-translation-layer logic, and I’ve noticed a tiny slowdown (less than 1%) when seeking across large ranges vs small: perhaps it’s busting the flash equivalent of a TLB.

Click here to view code image


# seeksize.bt
Attaching 3 probes...
Tracing block I/O requested seeks... Hit Ctrl-C to end.
^C
[...]

@sectors[tar]:
[0]                 8220 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1]                    0 |                                                    |
[2, 4)                 0 |                                                    |
[4, 8)                 0 |                                                    |
[8, 16)              882 |@@@@@                                               |
[16, 32)            1897 |@@@@@@@@@@@@                                        |
[32, 64)            1588 |@@@@@@@@@@                                          |
[64, 128)           1502 |@@@@@@@@@                                           |
[128, 256)          1105 |@@@@@@                                              |
[256, 512)           734 |@@@@                                                |
[512, 1K)            501 |@@@                                                 |
[1K, 2K)             302 |@                                                   |
[2K, 4K)             194 |@                                                   |
[4K, 8K)              82 |                                                    |
[8K, 16K)              0 |                                                    |
[16K, 32K)             0 |                                                    |
[32K, 64K)             6 |                                                    |
[64K, 128K)          191 |@                                                   |
[128K, 256K)           0 |                                                    |
[256K, 512K)           0 |                                                    |
[512K, 1M)             0 |                                                    |
[1M, 2M)               1 |                                                    |
[2M, 4M)             840 |@@@@@                                               |
[4M, 8M)             887 |@@@@@                                               |
[8M, 16M)            441 |@@                                                  |
[16M, 32M)           124 |                                                    |
[32M, 64M)           220 |@                                                   |
[64M, 128M)          207 |@                                                   |
[128M, 256M)         205 |@                                                   |
[256M, 512M)           3 |                                                    |
[512M, 1G)           286 |@                                                   |

@sectors[dd]:
[0]                29908 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1]                    0 |                                                    |
[...]
[32M, 64M)             0 |                                                    |
[64M, 128M)            1 |                                                    |

This output shows that processes named “dd” usually did not request any seeking: an offset of 0 was requested 29,908 times while tracing. This is expected, as I was running a dd(1) sequential workload. I also ran a tar(1) file system backup, which generated a mixed workload: some sequential, some random.

The source to seeksize(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing block I/O requested seeks... Hit Ctrl-C to end.\n");
}

tracepoint:block:block_rq_issue
{
        if (@last[args->dev]) {
                // calculate requested seek distance
                $last = @last[args->dev];
                $dist = (args->sector - $last) > 0 ?
                    args->sector - $last : $last - args->sector;

                // store details
                @sectors[args->comm] = hist($dist);
        }
        // save last requested position of disk head
        @last[args->dev] = args->sector + args->nr_sector;
}

END
{
        clear(@last);
}

This works by looking at the requested sector offset for each device I/O and comparing it to a recorded previous location. If the script is changed to use the block_rq_completion tracepoint, it will show the actual seeks encountered by the disk. But instead it uses the block_rq_issue tracepoint to answer a different question: how random is the workload the application is requesting? This randomness may change after the I/O is processed by the Linux I/O scheduler and by the on-disk scheduler. I first wrote this to prove which applications were causing random workloads, so I chose to measure the workload on requests.

The following tool, biopattern(8), measures randomness on I/O completion instead.

9.3.6 biopattern
biopattern(8)8 is a bpftrace tool to identify the pattern of I/O: random or sequential. For example:

8 Origin: I created the first version as iopattern using DTrace on 25-Jul-2005, based on a mockup that Ryan Matteson had sent me (which also had more columns). I created this bpftrace version for this book on 19-Mar-2019.

Click here to view code image


# biopattern.bt
Attaching 4 probes...
TIME      %RND  %SEQ    COUNT     KBYTES
00:05:54    83    16     2960      13312
00:05:55    82    17     3881      15524
00:05:56    78    21     3059      12232
00:05:57    73    26     2770      14204
00:05:58     0   100        1          0
00:05:59     0     0        0          0
00:06:00     0    99     1536     196360
00:06:01     0   100    13444    1720704
00:06:02     0    99    13864    1771876
00:06:03     0   100    13129    1680640
00:06:04     0    99    13532    1731484
[...]

This examples begins with a file system backup workload, which caused mostly random I/O. At 6:00 I switched to a sequential disk read, which was 99 or 100% sequential, and delivered a much higher throughput (KBYTES).

The source to biopattern(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("%-8s %5s %5s %8s %10s\n", "TIME", "%RND", "%SEQ", "COUNT",
            "KBYTES");
}

tracepoint:block:block_rq_complete
{
        if (@lastsector[args->dev] == args->sector) {
                @sequential++;
        } else {
                @random++;
        }
        @bytes = @bytes + args->nr_sector * 512;
        @lastsector[args->dev] = args->sector + args->nr_sector;
}

interval:s:1
{
        $count = @random + @sequential;
        $div = $count;
        if ($div == 0) {
                $div = 1;
        }
        time("%H:%M:%S ");
        printf("%5d %5d %8d %10d\n", @random * 100 / $div,
            @sequential * 100 / $div, $count, @bytes / 1024);
        clear(@random); clear(@sequential); clear(@bytes);
}

END
{
        clear(@lastsector);
        clear(@random); clear(@sequential); clear(@bytes);
}

This works by instrumenting block I/O completion and remembering the last sector (disk address) used for each device, so that it can be compared with the following I/O to see if it carried on from the previous address (sequential) or did not (random).9

9 Prior to the tracing era, I would identify random/sequential workloads by interpreting iostat(1) output and looking for high service times with small I/O sizes (random) or low service times with high I/O sizes (sequential).

This tool can be changed to instrument tracepoint:block:block_rq_insert, which will show the randomness of the workload applied (similar to seeksize(8)).

9.3.7 biostacks
biostacks(8)10 is a bpftrace tool that traces full I/O latency (from OS enqueue to device completion) with the I/O initialization stack trace. For example:

10 Origin: I created it for this book on 19-Mar-2019. I had constructed a similar tool live during an internal Facebook talk in 2018, and for the first time saw initialization stacks associated with I/O completion times.

Click here to view code image


# biostacks.bt
Attaching 5 probes...
Tracing block I/O with init stacks. Hit Ctrl-C to end.
^C
[...]

@usecs[
    blk_account_io_start+1
    blk_mq_make_request+1069
    generic_make_request+292
    submit_bio+115
    swap_readpage+310
    read_swap_cache_async+64
    swapin_readahead+614
    do_swap_page+1086
    handle_pte_fault+725
    __handle_mm_fault+1144
    handle_mm_fault+177
    __do_page_fault+592
    do_page_fault+46
    page_fault+69
]:
[16K, 32K)             1 |                                                    |
[32K, 64K)            32 |                                                    |
[64K, 128K)         3362 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[128K, 256K)          38 |                                                    |
[256K, 512K)           0 |                                                    |
[512K, 1M)             0 |                                                    |
[1M, 2M)               1 |                                                    |
[2M, 4M)               1 |                                                    |
[4M, 8M)               1 |                                                    |

@usecs[
    blk_account_io_start+1
    blk_mq_make_request+1069
    generic_make_request+292
    submit_bio+115
    submit_bh_wbc+384
    ll_rw_block+173
    __breadahead+68
    __ext4_get_inode_loc+914
    ext4_iget+146
    ext4_iget_normal+48
    ext4_lookup+240
    lookup_slow+171
    walk_component+451
    path_lookupat+132
    filename_lookup+182
    user_path_at_empty+54
    vfs_statx+118
    SYSC_newfstatat+53
    sys_newfstatat+14
    do_syscall_64+115
    entry_SYSCALL_64_after_hwframe+61
]:
[8K, 16K)             18 |@@@@@@@@@@@                                         |
[16K, 32K)            20 |@@@@@@@@@@@@                                        |
[32K, 64K)            10 |@@@@@@                                              |
[64K, 128K)           56 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[128K, 256K)          81 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[256K, 512K)           7 |@@@@                                                |

I have seen cases where there was mysterious disk I/O without any application causing it. The reason turned out to be background file system tasks. (In one case it was ZFS’s background scrubber, which periodically verifies checksums.) biostacks(8) can identify the real reason for disk I/O by showing the kernel stack trace.

The above output has two interesting stacks. The first was triggered by a page fault that became a swap in: this is swapping.11 The second was a newfstatat() syscall that became a readahead.

11 Linux terminology, where this means switching pages with the swap device. Swapping for other kernels can mean moving entire processes.

The source to biostacks(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing block I/O with init stacks. Hit Ctrl-C to end.\n");
}

kprobe:blk_account_io_start
{
        @reqstack[arg0] = kstack;
        @reqts[arg0] = nsecs;
}

kprobe:blk_start_request,
kprobe:blk_mq_start_request
/@reqts[arg0]/
{
        @usecs[@reqstack[arg0]] = hist(nsecs - @reqts[arg0]);
        delete(@reqstack[arg0]);
        delete(@reqts[arg0]);
}

END
{
        clear(@reqstack); clear(@reqts);
}

This works by saving the kernel stack and a timestamp when the I/O was initiated and retrieving that saved stack and timestamp when the I/O completed. These are saved in a map keyed by the struct request pointer, which is arg0 to the traced kernel functions. The kernel stack trace is recorded using the kstack builtin. You can change this to ustack to record the user-level stack trace or add them both.

With the Linux 5.0 switch to multi-queue only, the blk_start_request() function was removed from the kernel. On that and later kernels, this tool prints a warning:

Click here to view code image

Warning: could not attach probe kprobe:blk_start_request, skipping.
This can be ignored, or that kprobe can be deleted from the tool. The tool could also be rewritten to use tracepoints. See the “Tracepoints” subsection of Section 9.3.1.

9.3.8 bioerr
bioerr(8)12 traces block I/O errors and prints details. For example, running bioerr(8) on my laptop:

12 Origin: I created it for this book on 19-Mar-2019.

Click here to view code image


# bioerr.bt
Attaching 2 probes...
Tracing block I/O errors. Hit Ctrl-C to end.
00:31:52 device: 0,0, sector: -1, bytes: 0, flags: N, error: -5
00:31:54 device: 0,0, sector: -1, bytes: 0, flags: N, error: -5
00:31:56 device: 0,0, sector: -1, bytes: 0, flags: N, error: -5
00:31:58 device: 0,0, sector: -1, bytes: 0, flags: N, error: -5
00:32:00 device: 0,0, sector: -1, bytes: 0, flags: N, error: -5
[...]

This output is far more interesting than I was expecting. (I wasn’t expecting any errors, but ran it just in case.) Every two seconds there is a zero-byte request to device 0,0, which seems bogus, and which returns with a -5 error (EIO).

The previous tool, biostacks(8), was created to investigate this kind of issue. In this case I don’t need to see the latency, and I only want to see stacks for the device 0,0 I/O. I can tweak biostacks(8) to do this, although it can also be done as a bpftrace one-liner (in this case, I’ll check that the stack trace is still meaningful by the time this tracepoint is hit; if it were not still meaningful, I’d need to switch back to a kprobe of blk_account_io_start() to really catch the initialization of this I/O):

Click here to view code image


# bpftrace -e 't:block:block_rq_issue /args->dev == 0/ { @[kstack]++ }'
Attaching 1 probe...
^C

@[
    blk_peek_request+590
    scsi_request_fn+51
    __blk_run_queue+67
    blk_execute_rq_nowait+168
    blk_execute_rq+80
    scsi_execute+227
    scsi_test_unit_ready+96
    sd_check_events+248
    disk_check_events+101
    disk_events_workfn+22
    process_one_work+478
    worker_thread+50
    kthread+289
    ret_from_fork+53
]: 3

This shows that device 0 I/O was created from scsi_test_unit_ready(). A little more digging into the parent functions shows that it was checking for USB removable media. As an experiment, I traced scsi_test_unit_ready() while inserting a USB flash drive, which changed its return value. This was my laptop detecting USB drives.

The source to bioerr(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing block I/O errors. Hit Ctrl-C to end.\n");
}

tracepoint:block:block_rq_complete
/args->error != 0/
{
        time("%H:%M:%S ");
        printf("device: %d,%d, sector: %d, bytes: %d, flags: %s, error: %d\n",
            args->dev >> 20, args->dev & ((1 << 20) - 1), args->sector,
            args->nr_sector * 512, args->rwbs, args->error);
}

The logic for mapping the device identifier (args->dev) to the major and minor numbers comes from the format file for this tracepoint:

Click here to view code image


# cat /sys/kernel/debug/tracing/events/block/block_rq_complete/format
name: block_rq_complete
[...]

print fmt: "%d,%d %s (%s) %llu + %u [%d]", ((unsigned int) ((REC->dev) >> 20)),
((unsigned int) ((REC->dev) & ((1U << 20) - 1))), REC->rwbs, __get_str(cmd), (unsigned
long long)REC->sector, REC->nr_sector, REC->error

While bioerr(8) is a handy tool, note that perf(1) can be used for similar functionality by filtering on error. The output includes the format string as defined by the /sys format file. For example:

Click here to view code image


# perf record -e block:block_rq_complete --filter 'error != 0'
# perf script
     ksoftirqd/2    22 [002] 2289450.691041: block:block_rq_complete: 0,0 N ()
18446744073709551615 + 0 [-5]
[...]

The BPF tool can be customized to include more information, going beyond the standard capabilities of perf(1).

For example, the error returned, in this case -5 for EIO, has been mapped from a block error code. It may be interesting to see the original block error code, which can be traced from functions that handle it, for example:

Click here to view code image


# bpftrace -e 'kprobe:blk_status_to_errno /arg0/ { @[arg0]++ }'
Attaching 1 probe...
^C

@[10]: 2

It’s really block I/O status 10, which is BLK_STS_IOERR. These are defined in linux/blk_types.h:

Click here to view code image


#define BLK_STS_OK 0
#define BLK_STS_NOTSUPP         ((__force blk_status_t)1)
#define BLK_STS_TIMEOUT         ((__force blk_status_t)2)
#define BLK_STS_NOSPC           ((__force blk_status_t)3)
#define BLK_STS_TRANSPORT       ((__force blk_status_t)4)
#define BLK_STS_TARGET          ((__force blk_status_t)5)
#define BLK_STS_NEXUS           ((__force blk_status_t)6)
#define BLK_STS_MEDIUM          ((__force blk_status_t)7)
#define BLK_STS_PROTECTION      ((__force blk_status_t)8)
#define BLK_STS_RESOURCE        ((__force blk_status_t)9)
#define BLK_STS_IOERR           ((__force blk_status_t)10)

bioerr(8) could be enhanced to print these BLK_STS code names instead of the error numbers. These are actually mapped from SCSI result codes, which can be traced from the scsi events. I’ll demonstrate SCSI tracing in sections 9.3.11 and 9.3.12.

9.3.9 mdflush
mdflush(8)13 is a BCC and bpftrace tool for tracing flush events from md, the multiple devices driver that is used on some systems to implement software RAID. For example, running the BCC version on a production server using md:

13 Origin: I created it for BCC on 13-Feb-2015 and for bpftrace on 8-Sep-2018.

Click here to view code image


# mdflush
Tracing md flush requests... Hit Ctrl-C to end.
TIME     PID    COMM             DEVICE
23:43:37 333    kworker/0:1H     md0
23:43:37 4038   xfsaild/md0      md0
23:43:38 8751   filebeat         md0
23:43:43 5575   filebeat         md0
23:43:48 5824   filebeat         md0
23:43:53 5575   filebeat         md0
23:43:58 5824   filebeat         md0
[...]

md flush events are usually infrequent and cause bursts of disk writes, perturbing system performance. Knowing exactly when they occurred can be useful for correlation with monitoring dashboards, to see if they align with latency spikes or other problems.

This output shows a process called filebeat doing md flushes every five seconds (I just discovered this). filebeat is a service that sends log files to Logstash or directly to Elasticsearch.

This works by tracing the md_flush_request() function using a kprobe. Since the event frequency is low, the overhead should be negligible.

BCC
mdflush(8) currently does not support any options.

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/genhd.h>
#include <linux/bio.h>

BEGIN
{
        printf("Tracing md flush events... Hit Ctrl-C to end.\n");
        printf("%-8s %-6s %-16s %s", "TIME", "PID", "COMM", "DEVICE");
}

kprobe:md_flush_request
{
        time("%H:%M:%S ");
        printf("%-6d %-16s %s\n", pid, comm,
            ((struct bio *)arg1)->bi_disk->disk_name);
}

The program digs out the disk name via the struct bio argument.

9.3.10 iosched
iosched(8)14 traces the time that requests were queued in the I/O scheduler, and groups this by scheduler name. For example:

14 Origin: I created it for this book on 20-Mar-2019.

Click here to view code image


# iosched.bt
Attaching 5 probes...
Tracing block I/O schedulers. Hit Ctrl-C to end.
^C

@usecs[cfq]:
[2, 4)                 1 |                                                    |
[4, 8)                 3 |@                                                   |
[8, 16)               18 |@@@@@@@                                             |
[16, 32)               6 |@@                                                  |
[32, 64)               0 |                                                    |
[64, 128)              0 |                                                    |
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              6 |@@                                                  |
[1K, 2K)               8 |@@@                                                 |
[2K, 4K)               0 |                                                    |
[4K, 8K)               0 |                                                    |
[8K, 16K)             28 |@@@@@@@@@@@                                         |
[16K, 32K)           131 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32K, 64K)            68 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |

This shows the CFQ scheduler in use, with queueing times usually between eight and 64 milliseconds.

The source to iosched(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/blkdev.h>

BEGIN
{
        printf("Tracing block I/O schedulers. Hit Ctrl-C to end.\n");
}

kprobe:__elv_add_request
{
        @start[arg1] = nsecs;
}

kprobe:blk_start_request,
kprobe:blk_mq_start_request
/@start[arg0]/
{
        $r = (struct request *)arg0;
        @usecs[$r->q->elevator->type->elevator_name] =
            hist((nsecs - @start[arg0]) / 1000);
        delete(@start[arg0]);
}

END
{
        clear(@start);
}

This works by recording a timestamp when requests were added to an I/O scheduler via an elevator function, __elv_add_request(), and then calculating the time queued when the I/O was issued. This focuses tracing I/O to only those that pass via an I/O scheduler, and also focuses on tracing just the queued time. The scheduler (elevator) name is fetched from the struct request.

With the Linux 5.0 switch to multi-queue only, the blk_start_request() function was removed from the kernel. On that and later kernels this tool will print a warning about skipping the blk_start_request() kprobe, which can be ignored, or that kprobe can be removed from this program.

9.3.11 scsilatency
scsilatency(8)15 is a tool to trace SCSI commands with latency distributions. For example:

15 Origin: I created it for this book on 21-Mar-2019, inspired by similar tools I created for the 2011 DTrace book [Gregg 11].

Click here to view code image


# scsilatency.bt
Attaching 4 probes...
Tracing scsi latency. Hit Ctrl-C to end.
^C

@usecs[0, TEST_UNIT_READY]:
[128K, 256K)           2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                  |
[256K, 512K)           2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                  |
[512K, 1M)             0 |                                                    |
[1M, 2M)               1 |@@@@@@@@@@@@@@@@@                                   |
[2M, 4M)               2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                  |
[4M, 8M)               3 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[8M, 16M)              1 |@@@@@@@@@@@@@@@@@                                   |

@usecs[42, WRITE_10]:
[2K, 4K)               2 |@                                                   |
[4K, 8K)               0 |                                                    |
[8K, 16K)              2 |@                                                   |
[16K, 32K)            50 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@       |
[32K, 64K)            57 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@usecs[40, READ_10]:
[4K, 8K)              15 |@                                                   |
[8K, 16K)            676 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16K, 32K)           447 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                  |
[32K, 64K)             2 |                                                    |
[...]

This has a latency histogram for each SCSI command type, showing the opcode and command name (if available).

The source to scsilatency(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <scsi/scsi_cmnd.h>

BEGIN
{
        printf("Tracing scsi latency. Hit Ctrl-C to end.\n");
        // SCSI opcodes from scsi/scsi_proto.h; add more mappings if desired:
        @opcode[0x00] = "TEST_UNIT_READY";
        @opcode[0x03] = "REQUEST_SENSE";
        @opcode[0x08] = "READ_6";
        @opcode[0x0a] = "WRITE_6";
        @opcode[0x0b] = "SEEK_6";
        @opcode[0x12] = "INQUIRY";
        @opcode[0x18] = "ERASE";
        @opcode[0x28] = "READ_10";
        @opcode[0x2a] = "WRITE_10";
        @opcode[0x2b] = "SEEK_10";
        @opcode[0x35] = "SYNCHRONIZE_CACHE";
}

kprobe:scsi_init_io
{
        @start[arg0] = nsecs;
}

kprobe:scsi_done,
kprobe:scsi_mq_done
/@start[arg0]/
{
        $cmnd = (struct scsi_cmnd *)arg0;
        $opcode = *$cmnd->req.cmd & 0xff;
        @usecs[$opcode, @opcode[$opcode]] = hist((nsecs - @start[arg0]) / 1000);
}

END
{
        clear(@start); clear(@opcode);
}

There are many possible SCSI commands; this tool only translates a handful into the opcode names. Since the opcode number is printed with the output, if a translation is missing it can still be determined by referring to scsi/scsi_proto.h, and this tool can be enhanced to include it.

There are scsi tracepoints, and one is used in the next tool, but these lack a unique identifier, which would be needed as a BPF map key to store a timestamp.

Due to the Linux 5.0 switch to multi-queue only, the scsi_done() function was removed, and so the kprobe:scsi_done can be removed.

With the Linux 5.0 switch to multi-queue only, scsi_done() function was removed from the kernel. On that and later kernels this tool will print a warning about skipping the scsi_done() kprobe, which can be ignored, or that kprobe can be removed from this program.

9.3.12 scsiresult
scsiresult(8)16 summarizes SCSI command results: the host and status codes. For example:

16 Origin: I created it for this book on 21-Mar-2019, inspired by similar tools I created for the 2011 DTrace book [Gregg 11].

Click here to view code image


# scsiresult.bt
Attaching 3 probes...
Tracing scsi command results. Hit Ctrl-C to end.
^C

@[DID_BAD_TARGET, SAM_STAT_GOOD]: 1
@[DID_OK, SAM_STAT_CHECK_CONDITION]: 10
@[DID_OK, SAM_STAT_GOOD]: 2202

This shows 2202 results with the codes DID_OK and SAM_STAT_GOOD and one with DID_BAD_TARGET and SAM_STAT_GOOD. These codes are defined in the kernel source, for example, from include/scsi/scsi.h:

Click here to view code image


#define DID_OK          0x00    /* NO error                                */
#define DID_NO_CONNECT  0x01    /* Couldn't connect before timeout period  */
#define DID_BUS_BUSY    0x02    /* BUS stayed busy through time out period */
#define DID_TIME_OUT    0x03    /* TIMED OUT for other reason              */
#define DID_BAD_TARGET  0x04    /* BAD target.                             */
[...]

This tool can be used to identify anomalous results from SCSI devices.

The source to scsiresult(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing scsi command results. Hit Ctrl-C to end.\n");

        // host byte codes, from include/scsi/scsi.h:
        @host[0x00] = "DID_OK";
        @host[0x01] = "DID_NO_CONNECT";
        @host[0x02] = "DID_BUS_BUSY";
        @host[0x03] = "DID_TIME_OUT";
        @host[0x04] = "DID_BAD_TARGET";
        @host[0x05] = "DID_ABORT";
        @host[0x06] = "DID_PARITY";
        @host[0x07] = "DID_ERROR";
        @host[0x08] = "DID_RESET";
        @host[0x09] = "DID_BAD_INTR";
        @host[0x0a] = "DID_PASSTHROUGH";
        @host[0x0b] = "DID_SOFT_ERROR";
        @host[0x0c] = "DID_IMM_RETRY";
        @host[0x0d] = "DID_REQUEUE";
        @host[0x0e] = "DID_TRANSPORT_DISRUPTED";
        @host[0x0f] = "DID_TRANSPORT_FAILFAST";
        @host[0x10] = "DID_TARGET_FAILURE";
        @host[0x11] = "DID_NEXUS_FAILURE";
        @host[0x12] = "DID_ALLOC_FAILURE";
        @host[0x13] = "DID_MEDIUM_ERROR";

        // status byte codes, from include/scsi/scsi_proto.h:
        @status[0x00] = "SAM_STAT_GOOD";
        @status[0x02] = "SAM_STAT_CHECK_CONDITION";
        @status[0x04] = "SAM_STAT_CONDITION_MET";
        @status[0x08] = "SAM_STAT_BUSY";
        @status[0x10] = "SAM_STAT_INTERMEDIATE";
        @status[0x14] = "SAM_STAT_INTERMEDIATE_CONDITION_MET";
        @status[0x18] = "SAM_STAT_RESERVATION_CONFLICT";
        @status[0x22] = "SAM_STAT_COMMAND_TERMINATED";
        @status[0x28] = "SAM_STAT_TASK_SET_FULL";
        @status[0x30] = "SAM_STAT_ACA_ACTIVE";
        @status[0x40] = "SAM_STAT_TASK_ABORTED";
}

tracepoint:scsi:scsi_dispatch_cmd_done
{
        @[@host[(args->result >> 16) & 0xff], @status[args->result & 0xff]] =
            count();
}

END
{
        clear(@status);
        clear(@host);
}

This works by tracing the scsi:scsi_dispatch_cmd_done tracepoint and fetching the host and status bytes from the result, and then mapping them to kernel names. The kernel has similar lookup tables in include/trace/events/scsi.h for the tracepoint format string.

The result also has driver and message bytes, not shown by this tool. It is of the format:

Click here to view code image

driver_byte << 24 | host_byte << 16 | msg_byte << 8 | status_byte
This tool can be enhanced to add these bytes and other details to the map as additional keys. Other details are readily available in that tracepoint:

Click here to view code image


# bpftrace -lv t:scsi:scsi_dispatch_cmd_done
tracepoint:scsi:scsi_dispatch_cmd_done
    unsigned int host_no;
    unsigned int channel;
    unsigned int id;
    unsigned int lun;
    int result;
    unsigned int opcode;
    unsigned int cmd_len;
    unsigned int data_sglen;
    unsigned int prot_sglen;
    unsigned char prot_op;
    __data_loc unsigned char[] cmnd;

Even more details are available via kprobes of scsi functions, although without the interface stability.

9.3.13 nvmelatency
nvmelatency(8)17 traces the nvme storage driver and shows command latencies by disk and nvme command opcode. This can be useful for isolating device latency from the latency measured higher in the stack at the block I/O layer. For example:

17 Origin: I created it for this book on 21-Mar-2019, inspired by similar storage driver tools that I created for the 2011 DTrace book [Gregg 11].

Click here to view code image


# nvmelatency.bt
Attaching 4 probes...
Tracing nvme command latency. Hit Ctrl-C to end.
^C

@usecs[nvme0n1, nvme_cmd_flush]:
[8, 16)                2 |@@@@@@@@@                                           |
[16, 32)               7 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                   |
[32, 64)               6 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@                        |
[64, 128)             11 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              3 |@@@@@@@@@@@@@@                                      |
[1K, 2K)               8 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@               |
[2K, 4K)               1 |@@@@                                                |
[4K, 8K)               4 |@@@@@@@@@@@@@@@@@@                                  |

@usecs[nvme0n1, nvme_cmd_write]:
[8, 16)                3 |@@@@                                                |
[16, 32)              37 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32, 64)              20 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@                        |
[64, 128)              6 |@@@@@@@@                                            |
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              0 |                                                    |
[1K, 2K)               0 |                                                    |
[2K, 4K)               0 |                                                    |
[4K, 8K)               7 |@@@@@@@@@                                           |

@usecs[nvme0n1, nvme_cmd_read]:
[32, 64)            7653 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64, 128)            568 |@@@                                                 |
[128, 256)            45 |                                                    |
[256, 512)             4 |                                                    |
[512, 1K)              0 |                                                    |
[1K, 2K)               0 |                                                    |
[2K, 4K)               0 |                                                    |
[4K, 8K)               1 |                                                    |

This output showed that only one disk was in use, nvme0n1, and the latency distributions for three nvme command types.

Tracepoints for nvme were recently added to Linux, but I wrote this tool on a system that did not have them, to show what can be accomplished with kprobes and storage drivers. I began by frequency counting which nvme functions were in use during different I/O workloads:

Click here to view code image


# bpftrace -e 'kprobe:nvme* { @[func] = count(); }'
Attaching 184 probes...
^C

@[nvme_pci_complete_rq]: 5998
@[nvme_free_iod]: 6047
@[nvme_setup_cmd]: 6048
@[nvme_queue_rq]: 6071
@[nvme_complete_rq]: 6171
@[nvme_irq]: 6304
@[nvme_process_cq]: 12327

Browsing the source for these functions showed that latency could be traced as the time from nvme_setup_cmd() to nvme_complete_rq().

The existence of tracepoints can aid in tool development, even if you are on a system that lacks them. By inspecting how the nvme tracepoints worked [187], I was able to develop this tool more quickly, because the tracepoint source showed how to correctly interpret nvme opcodes.

The source to nvmelatency(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/blkdev.h>
#include <linux/nvme.h>

BEGIN
{
        printf("Tracing nvme command latency. Hit Ctrl-C to end.\n");
        // from linux/nvme.h:
        @ioopcode[0x00] = "nvme_cmd_flush";
        @ioopcode[0x01] = "nvme_cmd_write";
        @ioopcode[0x02] = "nvme_cmd_read";
        @ioopcode[0x04] = "nvme_cmd_write_uncor";
        @ioopcode[0x05] = "nvme_cmd_compare";
        @ioopcode[0x08] = "nvme_cmd_write_zeroes";
        @ioopcode[0x09] = "nvme_cmd_dsm";
        @ioopcode[0x0d] = "nvme_cmd_resv_register";
        @ioopcode[0x0e] = "nvme_cmd_resv_report";
        @ioopcode[0x11] = "nvme_cmd_resv_acquire";
        @ioopcode[0x15] = "nvme_cmd_resv_release";
}

kprobe:nvme_setup_cmd
{
        $req = (struct request *)arg1;
        if ($req->rq_disk) {
                @start[arg1] = nsecs;
                @cmd[arg1] = arg2;
        } else {
                @admin_commands = count();
        }
}

kprobe:nvme_complete_rq
/@start[arg0]/
{
        $req = (struct request *)arg0;
        $cmd = (struct nvme_command *)@cmd[arg0];
        $disk = $req->rq_disk;
        $opcode = $cmd->common.opcode & 0xff;
        @usecs[$disk->disk_name, @ioopcode[$opcode]] =
            hist((nsecs - @start[arg0]) / 1000);
        delete(@start[tid]); delete(@cmd[tid]);
}

END
{
        clear(@ioopcode); clear(@start); clear(@cmd);
}

If a request is created without a disk, it is an admin command. The script can be enhanced to decode and time the admin commands (see nvme_admin_opcode in include/linux/nvme.h). To keep this tool short, I simply counted admin commands so that if any are present they will be noted in the output.

9.4 BPF ONE-LINERS
These sections show BCC and bpftrace one-liners. Where possible, the same one-liner is implemented using both BCC and bpftrace.

9.4.1 BCC
Count block I/O tracepoints:

Click here to view code image

funccount t:block:*
Summarize block I/O size as a histogram:

Click here to view code image

argdist -H 't:block:block_rq_issue():u32:args->bytes'
Count block I/O request user stack traces:

Click here to view code image

stackcount -U t:block:block_rq_issue
Count block I/O type flags:

Click here to view code image

argdist -C 't:block:block_rq_issue():char*:args->rwbs'
Trace block I/O errors with device and I/O type:

Click here to view code image

trace 't:block:block_rq_complete (args->error) "dev %d type %s error %d", args->dev,
args->rwbs, args->error'
Count SCSI opcodes:

Click here to view code image

argdist -C 't:scsi:scsi_dispatch_cmd_start():u32:args->opcode'
Count SCSI result codes:

Click here to view code image

argdist -C 't:scsi:scsi_dispatch_cmd_done():u32:args->result'
Count nvme driver functions:

Click here to view code image

funccount 'nvme*'
9.4.2 bpftrace
Count block I/O tracepoints:

Click here to view code image

bpftrace -e 'tracepoint:block:* { @[probe] = count(); }'
Summarize block I/O size as a histogram:

Click here to view code image

bpftrace -e 't:block:block_rq_issue { @bytes = hist(args->bytes); }'
Count block I/O request user stack traces:

Click here to view code image

bpftrace -e 't:block:block_rq_issue { @[ustack] = count(); }'
Count block I/O type flags:

Click here to view code image

bpftrace -e 't:block:block_rq_issue { @[args->rwbs] = count(); }'
Show total bytes by I/O type:

Click here to view code image

bpftrace -e 't:block:block_rq_issue { @[args->rwbs] = sum(args->bytes); }'
Trace block I/O errors with device and I/O type:

Click here to view code image

bpftrace -e 't:block:block_rq_complete /args->error/ {
    printf("dev %d type %s error %d\n", args->dev, args->rwbs, args->error); }'
Summarize block I/O plug time as a histogram:

Click here to view code image

bpftrace -e 'k:blk_start_plug { @ts[arg0] = nsecs; }
    k:blk_flush_plug_list /@ts[arg0]/ { @plug_ns = hist(nsecs - @ts[arg0]);
    delete(@ts[arg0]); }'
Count SCSI opcodes:

Click here to view code image

bpftrace -e 't:scsi:scsi_dispatch_cmd_start { @opcode[args->opcode] = count(); }'
Count SCSI result codes (all four bytes):

Click here to view code image

bpftrace -e 't:scsi:scsi_dispatch_cmd_done { @result[args->result] = count(); }'
Show CPU distribution of blk_mq requests:

Click here to view code image

bpftrace -e 'k:blk_mq_start_request { @swqueues = lhist(cpu, 0, 100, 1); }'
Count scsi driver functions:

Click here to view code image

bpftrace -e 'kprobe:scsi* { @[func] = count(); }'
Count nvme driver functions:

Click here to view code image

bpftrace -e 'kprobe:nvme* { @[func] = count(); }'
9.4.3 BPF One-Liners Examples
Including some sample output, as was done for each tool, is also useful for illustrating one-liners.

Counting Block I/O Type Flags
Click here to view code image


# bpftrace -e 't:block:block_rq_issue { @[args->rwbs] = count(); }'
Attaching 1 probe...
^C

@[N]: 2
@[WFS]: 9
@[FF]: 12
@[N]: 13
@[WSM]: 23
@[WM]: 64
@[WS]: 86
@[R]: 201
@[R]: 285
@[W]: 459
@[RM]: 1112
@[RA]: 2128
@[R]: 3635
@[W]: 4578

This frequency counts the rwbs field that encodes the I/O type. While tracing, where were 3635 reads (“R”) and 2128 read-ahead I/O (“RA”). The “rwbs” section at the start of this chapter describes this rwbs field.

This one-liner can answer workload characterization questions such as:

What is the ratio of read versus read-ahead block I/O?

What is the ratio of write versus synchronous write block I/O?

By changing count() to be sum(args->bytes), this one-liner will sum the bytes by I/O type.

9.5 OPTIONAL EXERCISES
If not specified, these can be completed using either bpftrace or BCC:

Modify biolatency(8) to print a linear histogram instead, for the range 0 to 100 milliseconds and a step size of one millisecond.

Modify biolatency(8) to print the linear histogram summary every one second.

Develop a tool to show disk I/O completions by CPU, to check how these interrupts are balanced. It could be displayed as a linear histogram.

Develop a tool similar to biosnoop(8) to print per-event block I/O, with only the following fields, in CSV format: completion_time,direction,latency_ms. The direction is read or write.

Save two minutes of (4) and use plotting software to visualize it as a scatter plot, coloring reads red and writes blue.

Save two minutes of the output of (2) and use plotting software to display it as a latency heat map. (You can also develop some plotting software: e.g., use awk(1) to turn the count column into rows of a HTML table, with the background color scaled to the value.)

Rewrite biosnoop(8) to use block tracepoints.

Modify seeksize(8) to show the actual seek distances encountered by the storage devices: measured on completions.

Write a tool to show disk I/O timeouts. One solution could be to use the block tracepoints and BLK_STS_TIMEOUT (see bioerr(8)).

(Advanced, unsolved) Develop a tool that shows the lengths of block I/O merging as a histogram.

9.6 SUMMARY
This chapter shows how BPF can trace at all layers of the storage I/O stack. The tools traced the block I/O layer, the I/O scheduler, SCSI, and nvme as an example driver.

CopyAdd HighlightAdd Note
back to top
