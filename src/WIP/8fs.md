Chapter 8. File Systems
Analysis of file systems has historically focused on disk I/O and its performance, but file systems are often a more relevant target for beginning your analysis. It is the file system that applications usually interact with directly, and file systems can use caching, read-ahead, buffering, and asynchronous I/O to avoid exposing disk I/O latency to the application.

Since there are few traditional tools for file system analysis, it is an area where BPF tracing can really help. File system tracing can measure the full time an application was waiting on I/O, including disk I/O, locks, or other CPU work. It can show the process responsible, and the files operated upon: useful context that can be much harder to fetch from down at the disk level.

Learning Objectives:

Understand file system components: VFS, caches, and write-back

Understand targets for file system analysis with BPF

Learn a strategy for successful analysis of file system performance

Characterize file system workloads by file, operation type, and by process

Measure latency distributions for file system operations, and identify bi-modal distributions and issues of latency outliers

Measure the latency of file system write-back events

Analyze page cache and read ahead performance

Observe directory and inode cache behavior

Use bpftrace one-liners to explore file system usage in custom ways

This chapter begins with the necessary background for file system analysis, summarizing the I/O stack and caching. I explore the questions that BPF can answer, and provide an overall strategy to follow. I then focus on tools, starting with traditional file system tools and then BPF tools, including a list of BPF one-liners. This chapter ends with optional exercises.

8.1 BACKGROUND
This section covers file system fundamentals, BPF capabilities, and a suggested strategy for file system analysis.

8.1.1 File Systems Fundamentals
I/O Stack
A generic I/O stack is shown in Figure 8-1, showing the path of I/O from the application to disk devices.


Figure 8-1 Generic I/O stack

Some terminology has been included in the diagram: logical I/O describes requests to the file system. If these requests must be served from the storage devices, they become physical I/O. Not all I/O will; many logical read requests may be returned from the file system cache, and never become physical I/O. Raw I/O is included on the diagram, though it is rarely used nowadays: it is a way for applications to use disk devices with no file system.

File systems are accessed via a virtual file system (VFS), a generic kernel interface allowing multiple different file systems to be supported using the same calls, and new file systems to be easily added. It provides operations for read, write, open, close, etc., which are mapped by file systems to their own internal functions.

After the file system, a volume manager may also be in use to manage the storage devices. There is also a block I/O subsystem for managing I/O to devices, including a queue, merge capabilities, and more. These are covered in Chapter 9.

File System Caches
Linux uses multiple caches to improve the performance of storage I/O via the file system, as shown in Figure 8-2.


Figure 8-2 Linux FS caches

These caches are:

Page cache: This contains virtual memory pages including the contents of files and I/O buffers (what was once a separate “buffer cache”), and improves the performance of file and directory I/O.

Inode cache: Inodes (index nodes) are data structures used by file systems to describe their stored objects. VFS has its own generic version of an inode, and Linux keeps a cache of these because they are frequently read for permission checks and other metadata.

Directory cache: Called the dcache, this caches mappings from directory entry names to VFS inodes, improving the performance of path name lookups.

The page cache grows to be the largest of all these, because it not only caches the contents of files, but also includes “dirty” pages that have been modified but not yet written to disk. Various situations can trigger a write of these dirty pages, including a set interval (e.g., 30 seconds), an explicit sync() call, and the page-out deamon (kswapd) explained in Chapter 7.

Read-Ahead
A file system feature called read ahead or prefetch, involves detecting a sequential read workload, predicting the next pages that will be accessed, and loading them into the page cache. This pre-warming improves read performance only for sequential access workloads, not random access workloads. Linux also supports an explicit readahead() syscall.

Write-Back
Linux supports file system writes in write-back mode, where buffers are dirtied in memory and flushed to disk sometime later by kernel worker threads, so as not to block applications directly on slow disk I/O.

Further Reading
This was a brief summary intended to arm you with essential knowledge before you use the tools. File systems are covered in much more depth in Chapter 8 of Systems Performance [Gregg 13b].

8.1.2 BPF Capabilities
Traditional performance tools have focused on disk I/O performance, not file system performance. BPF tools can provide this missing observability, showing operations, latencies, and internal functions of each file system.

Questions that BPF can help answer include:

What are the file system requests? Counts by type?

What are the read sizes to the file system?

How much write I/O was synchronous?

What is the file workload access pattern: random or sequential?

What files are accessed? By what process or code path? Bytes, I/O counts?

What file system errors occurred? What type, and for whom?

What is the source of file system latency? Is it disks, the code path, locks?

What is the distribution of file system latency?

What is the ratio of Dcache and Icache hits vs misses?

What is the page cache hit ratio for reads?

How effective is prefetch/read-ahead? Should this be tuned?

As shown in the previous figures, you can trace the I/O involved to find the answers to many of these questions.

Event Sources
I/O types are listed in Table 8-1 with the event sources that can instrument them.

Table 8-1 I/O Types and Event Sources

I/O Type

Event Source

Application and library I/O

uprobes

System call I/O

syscalls tracepoints

File system I/O

ext4 (...) tracepoints, kprobes

Cache hits (reads), write-back (writes)

kprobes

Cache misses (reads), write-through (writes)

kprobes

Page cache write-back

writeback tracepoints

Physical disk I/O

block tracepoints, kprobes

Raw I/O

kprobes

This provides visibility from the application to devices. File system I/O may be visible from file system tracepoints, depending on the file system. For example, ext4 provides over one hundred tracepoints.

Overhead
Logical I/O, especially reads and writes to the file system cache, can be very frequent: over 100k events per second. Use caution when tracing these, since the performance overhead at this rate may begin to become noticeable. Also be careful with VFS tracing: VFS is also used by many network I/O paths, so this adds overhead to packets as well, which may also have a high rate.1

1 Although Linux uses software or hardware segmentation offload to reduce the number of packets at this layer, so the event rate may be much lower than the wire-packet rate; see the netsize(8) tool in Chapter 10.

Physical disk I/O on most servers is typically so low (less than 1000 IOPS), that tracing it incurs negligible overhead. Some storage and database servers may be exceptions: check the I/O rate beforehand with iostat(1).

8.1.3 Strategy
If you are new to file system performance analysis, here is a suggested overall strategy that you can follow. The next sections explain these tools in more detail.

Identify the mounted file systems: see df(1) and mount(8).

Check the capacity of mounted file systems: in the past, there have been performance issues when certain file systems approach 100% full, due to the use of different free-block-finding algorithms (e.g., FFS, ZFS2).

2 The zpool 80% rule, although from memory I was able to move that to 99% when building storage products. Also see “Pool performance can degrade when a pool is very full” from the ZFS Recommended Storage Pool Practices guide [83].

Instead of using unfamiliar BPF tools to understand an unknown production workload, first use those on a known workload. On an idle system, create a known file system workload, e.g., using the fio(1) tool.

Run opensnoop(8) to see which files are being opened.

Run filelife(8) to check for issues of short-lived files.

Look for unusually slow file system I/O, and examine process and file details (e.g., using ext4slower(8), btrfsslower(8), zfsslower(8), etc., or as a catch-all with possibly higher overhead, fileslower(8)). It may reveal a workload that can be eliminated, or quantify a problem to aid file system tuning.

Examine the distribution of latency for your file systems (e.g., using ext4dist(8), btrfsdist(8), zfsdist(8), etc.). This may reveal bi-modal distributions or latency outliers that are causing performance problems, that can be isolated and investigated more with other tools.

Examine the page cache hit ratio over time (e.g., using cachestat(8)): does any other workload perturb the hit ratio, or does any tuning improve it?

Use vfsstat(8) to compare logical I/O rates to physical I/O rates from iostat(1): ideally, there is a much higher rate of logical than physical I/O, indicating that caching is effective.

Browse and execute the BPF tools listed in the BPF tools section of this book.

8.2 TRADITIONAL TOOLS
Because analysis has historically focused on the disks, there are few traditional tools for observing file systems. This section summarizes file system analysis using df(1), mount(1), strace(1), perf(1), and fatrace(1).

Note that file system performance analysis has often been the domain of micro-benchmark tools, rather than observability tools. A recommended example of a file system micro-benchmark tool is fio(1).

8.2.1 df
df(1) shows file system disk usage:

Click here to view code image


$ df -h
Filesystem      Size  Used Avail Use% Mounted on
udev             93G     0   93G   0% /dev
tmpfs            19G  4.0M   19G   1% /run
/dev/nvme0n1    9.7G  5.1G  4.6G  53% /
tmpfs            93G     0   93G   0% /dev/shm
tmpfs           5.0M     0  5.0M   0% /run/lock
tmpfs            93G     0   93G   0% /sys/fs/cgroup
/dev/nvme1n1    120G   18G  103G  15% /mnt
tmpfs            19G     0   19G   0% /run/user/60000

The output includes some virtual physical systems, mounted using the tmpfs device, which are used for containing system state.

Check disk-based file systems for their percent utilization (“Use%” column). For example, in the above output this is “/” and “/mnt”, at 53% and 15% full. Once a file system exceeds about 90% full, it may begin to suffer performance issues as available free blocks become fewer and more scattered, turning sequential write workloads into random write workloads. Or it may not: this is really dependent on the file system implementation. It’s just worth a quick look.

8.2.2 mount
The mount(1) command makes file systems accessible, and can also list their type and mount flags:

Click here to view code image


$ mount
sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)
proc on /proc type proc (rw,nosuid,nodev,noexec,relatime,gid=60243,hidepid=2)
udev on /dev type devtmpfs
(rw,nosuid,relatime,size=96902412k,nr_inodes=24225603,mode=755)
devpts on /dev/pts type devpts
(rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000)
tmpfs on /run type tmpfs (rw,nosuid,noexec,relatime,size=19382532k,mode=755)
/dev/nvme0n1 on / type ext4 (rw,noatime,nobarrier,data=ordered)
[...]

This output shows that the “/” (root) file system is ext4, mounted with options including “noatime,” a performance tuning that skips recording access timestamps.

8.2.3 strace
strace(1) can trace system calls, which provides a view of file system operations. In this example, the -ttt option is used to print wall timestamps with microsecond resolution as the first field, and -T to print the time spent in syscalls as the last field. All times are printed in seconds.

Click here to view code image


$ strace cksum -tttT /usr/bin/cksum
[...]
1548892204.789115 openat(AT_FDCWD, "/usr/bin/cksum", O_RDONLY) = 3 <0.000030>
1548892204.789202 fadvise64(3, 0, 0, POSIX_FADV_SEQUENTIAL) = 0 <0.000049>
1548892204.789308 fstat(3, {st_mode=S_IFREG|0755, st_size=35000, ...}) = 0 <0.000025>
1548892204.789397 read(3, "\177ELF\2\1\1\0\0\0\0\0\0\0\0\0\3\0>
\0\1\0\0\0\0\33\0\0\0\0\0\0"..., 65536) = 35000 <0.000072>
1548892204.789526 read(3, "", 28672)    = 0 <0.000024>
1548892204.790011 lseek(3, 0, SEEK_CUR) = 35000 <0.000024>
1548892204.790087 close(3)              = 0 <0.000025>
[...]

strace(1) formats the arguments to syscalls in a human-readable way.

All this information should be extremely valuable for performance analysis, but there’s a catch: strace(1) has historically been implemented to use ptrace(2), which operates by inserting breakpoints at the start and end of syscalls. This can massively slow down target software, by as much as over 100 fold, making strace(1) dangerous for use in production environments. It is more useful as a troubleshooting tool, where such slowdowns can be tolerated.

There have been multiple projects to develop an strace(1) replacement using buffered tracing. One is for perf(1), covered next.

8.2.4 perf
The Linux perf(1) multi-tool can trace file system tracepoints, use kprobes to inspect VFS and file system internals, and has a trace subcommand as a more efficient version of strace(1). For example:

Click here to view code image


# perf trace cksum /usr/bin/cksum
[...]
 0.683 ( 0.013 ms): cksum/20905 openat(dfd: CWD, filename: 0x4517a6cc)           = 3
 0.698 ( 0.002 ms): cksum/20905 fadvise64(fd: 3, advice: 2)                      = 0
 0.702 ( 0.002 ms): cksum/20905 fstat(fd: 3, statbuf: 0x7fff45169610)            = 0
 0.713 ( 0.059 ms): cksum/20905 read(fd: 3, buf: 0x7fff45169790, count: 65536)   = 35000
 0.774 ( 0.002 ms): cksum/20905 read(fd: 3, buf: 0x7fff45172048, count: 28672)   = 0
 0.875 ( 0.002 ms): cksum/20905 lseek(fd: 3, whence: CUR)                        = 35000
 0.879 ( 0.002 ms): cksum/20905 close(fd: 3)                                     = 0
[...]

The output of perf trace has been improving in each Linux version (the above demonstrates Linux 5.0). Arnaldo Carvalho de Melo has been improving this further, using kernel header parsing and BPF to improve the output [84]; future versions should, for example, show the filename string for the openat() call, instead of just the filename pointer address.

The more commonly used perf(1) subcommands, stat and record, can be used with file system tracepoints, when such tracepoints for a file system are available. For example, counting ext4 calls system-wide via ext4 tracepoints:

Click here to view code image


# perf stat -e 'ext4:*' -a
^C
 Performance counter stats for 'system wide':
                 0      ext4:ext4_other_inode_update_time
                 1      ext4:ext4_free_inode
                 1      ext4:ext4_request_inode
                 1      ext4:ext4_allocate_inode
                 1      ext4:ext4_evict_inode
                 1      ext4:ext4_drop_inode
               163      ext4:ext4_mark_inode_dirty
                 1      ext4:ext4_begin_ordered_truncate
                 0      ext4:ext4_write_begin
               260      ext4:ext4_da_write_begin
                 0      ext4:ext4_write_end
                 0      ext4:ext4_journalled_write_end
               260      ext4:ext4_da_write_end
                 0      ext4:ext4_writepages
                 0      ext4:ext4_da_write_pages
[...]

The ext4 file system provides around one hundred tracepoints for visibility into its requests and internals. Each of these has format strings for associated information, for example (do not run this command):

Click here to view code image


# perf record -e ext4:ext4_da_write_begin -a
^C[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 1376.293 MB perf.data (14394798 samples) ]

Well, this is embarrassing, but it’s an important lesson for file system tracing. Because perf record will write events to the file system, if you trace file system (or disk) writes you can create a feedback loop, as I just did here, resulting in 14 million samples and a 1.3 Gbyte perf.data file!

The format string for this example looks like this:

Click here to view code image


# perf script
[...]
  perf 26768 [005] 275068.339717: ext4:ext4_da_write_begin: dev 253,1 ino 1967479 pos
5260704 len 192 flags 0
  perf 26768 [005] 275068.339723: ext4:ext4_da_write_begin: dev 253,1 ino 1967479 pos
5260896 len 8 flags 0
  perf 26768 [005] 275068.339729: ext4:ext4_da_write_begin: dev 253,1 ino 1967479 pos
5260904 len 192 flags 0
  perf 26768 [005] 275068.339735: ext4:ext4_da_write_begin: dev 253,1 ino 1967479 pos
5261096 len 8 flags 0
[...]

The format string (one has been highlighted in bold) includes the device, inode, position, length, and flags for the write.

File systems may support many tracepoints, or some, or none. XFS, for example, has around 500. If your file system does not have tracepoints, you can try to instrument its internals using kprobes instead.

For comparison with later BPF tools, consider the same tracepoint instrumented using bpftrace to summarize the length argument as a histogram:

Click here to view code image


# bpftrace -e 'tracepoint:ext4:ext4_da_write_begin { @ = hist(args->len); }'
Attaching 1 probe...
^C

@:
[16, 32)              26 |@@@@@@@@                                            |
[32, 64)               4 |@                                                   |
[64, 128)             27 |@@@@@@@@                                            |
[128, 256)            15 |@@@@                                                |
[256, 512)            10 |@@@                                                 |
[512, 1K)              0 |                                                    |
[1K, 2K)               0 |                                                    |
[2K, 4K)              20 |@@@@@@                                              |
[4K, 8K)             164 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

This shows that most of the lengths were between four and eight Kbytes. This summary is performed in kernel context, and does not require writing a perf.data file to the file system. This avoids not only the overhead of those writes and additional overhead to post-process, but also the risk of a feedback loop.

8.2.5 fatrace
fatrace(1) is a specialized tracer that uses the Linux fanotify API (file access notify). Example output:

Click here to view code image


# fatrace
cron(4794): CW /tmp/#9346 (deleted)
cron(4794): RO /etc/login.defs
cron(4794): RC /etc/login.defs
rsyslogd(872): W /var/log/auth.log
sshd(7553): O /etc/motd
sshd(7553): R /etc/motd
sshd(7553): C /etc/motd
[...]

Each line shows the process name, PID, type of event, full path, and optional status. The type of event can be opens (O), reads (R), writes (W), and closes (C). fatrace(1) can be used for workload characterization: understanding the files accessed, and looking for unnecessary work that could be eliminated.

However, for a busy file system workload, fatrace(1) can produce tens of thousands of lines of output every second, and can cost significant CPU resources. This may be alleviated somewhat by filtering to one type of event, for example, opens only:

Click here to view code image


# fatrace -f O
run(6383): O /bin/sleep
run(6383): RO /lib/x86_64-linux-gnu/ld-2.27.so
sleep(6383): O /etc/ld.so.cache
sleep(6383): RO /lib/x86_64-linux-gnu/libc-2.27.so
[...]

In the following BPF section, a dedicated BPF tool is provided for this: opensnoop(8), which provides more command line options and is also much more efficient. Comparing the CPU overhead of fatrace -f O vs BCC opensnoop(8) for the same heavy file system workload:

Click here to view code image


# pidstat 10
[...]
09:38:54 PM   UID   PID    %usr %system  %guest   %wait    %CPU   CPU  Command
09:39:04 PM     0  6075   11.19   56.44    0.00    0.20   67.63     1  fatrace
[...]
09:50:32 PM     0  7079    0.90    0.20    0.00    0.00    1.10     2  opensnoop
[...]

opensnoop(8) is consuming 1.1% CPU vs fatrace(1)’s 67%.3

3 This is running BCC opensnoop(8) as-is. By tuning the polling loop (inserting a delay to increase buffering), I was able to take the overhead down to 0.6%.

8.3 BPF TOOLS
This section covers the BPF tools you can use for file system performance analysis and troubleshooting (see Figure 8-3).


Figure 8-3 BPF tools for file system analysis

These tools are either from the BCC and bpftrace repositories (covered in Chapters 4 and 5), or were created for this book. Some tools appear in both BCC and bpftrace. Table 8-2 lists the origins of the tools covered in this section (BT is short for bpftrace).

Table 8-2 File System–Related Tools

Tool

Source

Target

Description

opensnoop

BCC/BT

Syscalls

Trace files opened

statsnoop

BCC/BT

Syscalls

Trace calls to stat(2) varieties

syncsnoop

BCC/BT

Syscalls

Trace sync(2) and variety calls with timestamps

mmapfiles

Book

Syscalls

Count mmap(2) files

scread

Book

Syscalls

Count read(2) files

fmapfault

Book

Page cache

Count file map faults

filelife

BCC/book

VFS

Trace short-lived files with their lifespan in seconds

vfsstat

BCC/BT

VFS

Common VFS operation statistics

vfscount

BCC/BT

VFS

Count all VFS operations

vfssize

Book

VFS

Show VFS read/write sizes

fsrwstat

Book

VFS

Show VFS reads/writes by file system type

fileslower

BCC/book

VFS

Show slow file reads/writes

filetop

BCC

VFS

Top files in use by IOPS and bytes

filetype

Book

VFS

Show VFS reads/writes by file type and process

writesync

Book

VFS

Show regular file writes by sync flag

cachestat

BCC

Page cache

Page cache statistics

writeback

BT

Page cache

Show write-back events and latencies

dcstat

BCC/book

Dcache

Directory cache hit statistics

dcsnoop

BCC/BT

Dcache

Trace directory cache lookups

mountsnoop

BCC

VFS

Trace mount and umounts system-wide

xfsslower

BCC

XFS

Show slow XFS operations

xfsdist

BCC

XFS

Common XFS operation latency histograms

ext4dist

BCC/book

ext4

Common ext4 operation latency histograms

icstat

Book

Icache

Inode cache hit statistics

bufgrow

Book

Buffer cache

Buffer cache growth by process and bytes

readahead

Book

VFS

Show read ahead hits and efficiency

For the tools from BCC and bpftrace, see their repositories for full and updated lists of tool options and capabilities. A selection of the most important capabilities are summarized here.

The following tool summaries include a discussion on translating file descriptors to filenames (see scread(8)).

8.3.1 opensnoop
opensnoop(8)4 was shown in Chapters 1 and 4, and is provided by BCC and bpftrace. It traces file opens and is useful for discovering the location of data files, log files, and configuration files. It can also discover performance problems caused by frequent opens, or help troubleshoot issues caused by missing files. Example output from a production system, with -T to include timestamps:

4 Origin: I created the first version as opensnoop.d on 9-May-2004, it was simple, useful, and being able to see opens system-wide was amazing. My prior approaches to achieve this had been to use truss(1M) on a single process only, or BSM auditing, which required changing the state of the system. The name “snoop” comes from the Solaris network sniffer, snoop(1M), and the terminology “snooping events.” opensnoop has since been ported to many other tracers, by myself and others. I wrote the BCC version on 17-Sep-2015, and bpftrace on 8-Sep-2018.

Click here to view code image


# opensnoop -T
TIME(s)       PID    COMM     FD ERR PATH
0.000000000   3862   java   5248   0 /proc/loadavg
0.000036000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs_quota_us
0.000051000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs_period_us
0.000059000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.shares
0.012956000   3862   java   5248   0 /proc/loadavg
0.012995000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs_quota_us
0.013012000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs_period_us
0.013020000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.shares
0.021259000   3862   java   5248   0 /proc/loadavg
0.021301000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs_quota_us
0.021317000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.cfs
0.021325000   3862   java   5248   0 /sys/fs/cgroup/cpu,cpuacct/.../cpu.shares
0.022079000   3862   java   5248   0 /proc/loadavg
[...]

The output rate was high, and shows that a group of four files are read at a rate of one hundred times per second by Java (I just discovered this5). The filename has been partially truncated in this book to fit. These are in-memory files of system metrics, and reading them should be fast, but does Java really need to read them one hundred times every second? My next step in analysis was to fetch the stack responsible. Since these were the only file opens that this Java process was performing, I simply counted stacks for the open tracepoint for this PID using:

5 I intended to run opensnoop on several production servers to find some interesting output to include here. I saw this on the first one I tried.

Click here to view code image

 stackcount -p 3862 't:syscalls:sys_enter_openat'
This showed the full stack trace, including the Java methods6 responsible. The culprit turned out to be new load balancing software.

6 See Chapter 18 for how to get Java stacks and symbols to work.

opensnoop(8) works by tracing the open(2) variant syscalls: open(2) and openat(2). The overhead is expected to be negligible as the open(2) rate is typically infrequent.

BCC
Command line usage:

opensnoop [options]
Options include:

-x: Show only failed opens

-p PID: Measure this process only

-n NAME: Only show opens when the process name contains NAME

bpftrace
The following is the code for the bpftrace version, which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing open syscalls... Hit Ctrl-C to end.\n");
        printf("%-6s %-16s %4s %3s %s\n", "PID", "COMM", "FD", "ERR", "PATH");
}

tracepoint:syscalls:sys_enter_open,
tracepoint:syscalls:sys_enter_openat
{
        @filename[tid] = args->filename;
}

tracepoint:syscalls:sys_exit_open,
tracepoint:syscalls:sys_exit_openat
/@filename[tid]/
{

        $ret = args->ret;
        $fd = $ret > 0 ? $ret : -1;
        $errno = $ret > 0 ? 0 : - $ret;

        printf("%-6d %-16s %4d %3d %s\n", pid, comm, $fd, $errno,
            str(@filename[tid]));
        delete(@filename[tid]);
}

END
{
        clear(@filename);
}

This program traces open(2) and openat(2) syscalls, and teases apart the file descriptor or error number from the return value. The filename is cached on the entry probe so that it can be fetched and printed on syscall exit, along with the return value.

8.3.2 statsnoop
statsnoop(8)7 is a BCC and bpftrace tool similar to opensnoop(8) but for the stat(2) family syscalls. stat(2) returns file statistics. This tool is useful for the same reasons as opensnoop(8): discovering file locations, finding performance issues of load, and troubleshooting missing files. Example production output, with -t for timestamps:

7 Origin: I first created this using DTrace on 9-Sep-2007 as a companion to opensnoop. I wrote the BCC version on 8-Feb-2016 and bpftrace on 8-Sep-2018.

Click here to view code image


# statsnoop -t
TIME(s)       PID    COMM             FD ERR PATH
0.000366347   9118   statsnoop        -1   2 /usr/lib/python2.7/encodings/ascii
0.238452415   744    systemd-resolve   0   0 /etc/resolv.conf
0.238462451   744    systemd-resolve   0   0 /run/systemd/resolve/resolv.conf
0.238470518   744    systemd-resolve   0   0 /run/systemd/resolve/stub-resolv.conf
0.238497017   744    systemd-resolve   0   0 /etc/resolv.conf
0.238506760   744    systemd-resolve   0   0 /run/systemd/resolve/resolv.conf
0.238514099   744    systemd-resolve   0   0 /run/systemd/resolve/stub-resolv.conf
0.238645046   744    systemd-resolve   0   0 /etc/resolv.conf
0.238659277   744    systemd-resolve   0   0 /run/systemd/resolve/resolv.conf
0.238667182   744    systemd-resolve   0   0 /run/systemd/resolve/stub-resolv.conf
[...]

This output shows systemd-resolve (which is really “systemd-resolved” truncated) calling stat(2) on the same three files in a loop.

I found a number of occasions when stat(2)s were called tens of thousands of times per second on production servers without a good reason; fortunately, it’s a fast syscall, so these were not causing major performance issues. There was one exception, however, where a Netflix microservice hit 100% disk utilization, which I found was caused by a disk usage monitoring agent calling stat(2) continually on a large file system where the metadata did not fully cache, and the stat(2) calls became disk I/O.

This tool works by tracing stat(2) variants via tracepoints: statfs(2), statx(2), newstat(2), and newlstat(2). The overhead of this tool is expected to be negligible, unless the stat(2) rate was very high.

BCC
Command line usage:

Click here to view code image

statsnoop [options]
Options include:

-x: Show only failed stats

-t: Include a column of timestamps (seconds)

-p PID: Measure this process only

bpftrace
The following is the code for the bpftrace version, which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing stat syscalls... Hit Ctrl-C to end.\n");
        printf("%-6s %-16s %3s %s\n", "PID", "COMM", "ERR", "PATH");
}

tracepoint:syscalls:sys_enter_statfs
{
        @filename[tid] = args->pathname;
}

tracepoint:syscalls:sys_enter_statx,
tracepoint:syscalls:sys_enter_newstat,
tracepoint:syscalls:sys_enter_newlstat
{
        @filename[tid] = args->filename;
}

tracepoint:syscalls:sys_exit_statfs,
tracepoint:syscalls:sys_exit_statx,
tracepoint:syscalls:sys_exit_newstat,
tracepoint:syscalls:sys_exit_newlstat
/@filename[tid]/
{
        $ret = args->ret;
        $errno = $ret >= 0 ? 0 : - $ret;

        printf("%-6d %-16s %3d %s\n", pid, comm, $errno,
            str(@filename[tid]));
        delete(@filename[tid]);
}

END
{
        clear(@filename);
}

The program stashes the filename on syscall entry, and fetches it on return to display with return details.

8.3.3 syncsnoop
syncsnoop(8)8 is a BCC and bpftrace tool to show sync(2) calls with timestamps. sync(2) flushes dirty data to disk. Here is some output from the bpftrace version:

8 Origin: In the past, I’ve debugged issues of syncs causing application latency spikes, where disk reads then queued behind a bunch of writes from the sync. These syncs are usually infrequent, so it’s always been sufficient to have the second offset of when they occurred to correlate with performance monitoring dashboards. I created this tool for BCC on 13-Aug-2015 and bpftrace on 6-Sep-2018.

Click here to view code image


# syncsnoop.bt
Attaching 7 probes...
Tracing sync syscalls... Hit Ctrl-C to end.
TIME      PID    COMM             EVENT
08:48:31  14172  TaskSchedulerFo  tracepoint:syscalls:sys_enter_fdatasync
08:48:31  14172  TaskSchedulerFo  tracepoint:syscalls:sys_enter_fdatasync
08:48:31  14172  TaskSchedulerFo  tracepoint:syscalls:sys_enter_fdatasync
08:48:31  14172  TaskSchedulerFo  tracepoint:syscalls:sys_enter_fdatasync
08:48:31  14172  TaskSchedulerFo  tracepoint:syscalls:sys_enter_fdatasync
08:48:40  17822  sync             tracepoint:syscalls:sys_enter_sync
[...]

This output shows “TaskSchedulerFo” (a truncated name) calling fdatasync(2) five times in a row. sync(2) calls can trigger bursts of disk I/O, perturbing performance on the system. Timestamps are printed so that they can be correlated with performance issues seen in monitoring software, which would be a clue that sync(2) and the disk I/O it triggers is responsible.

This tool works by tracing sync(2) variants via tracepoints: sync(2), syncfs(2), fsync(2), fdatasync(2), sync_file_range(2), and msync(2). The overhead of this tool is expected to be negligible, as the rate of sync(2) is typically very infrequent.

BCC
The BCC version currently does not support options, and works similarly to the bpftrace version.

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing sync syscalls... Hit Ctrl-C to end.\n");
        printf("%-9s %-6s %-16s %s\n", "TIME", "PID", "COMM", "EVENT");
}

tracepoint:syscalls:sys_enter_sync,
tracepoint:syscalls:sys_enter_syncfs,
tracepoint:syscalls:sys_enter_fsync,
tracepoint:syscalls:sys_enter_fdatasync,
tracepoint:syscalls:sys_enter_sync_file_range,
tracepoint:syscalls:sys_enter_msync
{
        time("%H:%M:%S  ");
        printf("%-6d %-16s %s\n", pid, comm, probe);
}

If sync(2) related calls were found to be a problem, they can be examined further with custom bpftrace, showing the arguments and return value, and issued disk I/O.

8.3.4 mmapfiles
mmapfiles(8)9 traces mmap(2) and frequency counts the file that is mapped to memory address ranges. For example:

9 Origin: I created this for DTrace on 18-Oct-2005, and this bpftrace version for this book on 26-Jan-2019.

Click here to view code image


# mmapfiles.bt
Attaching 1 probe...
^C

@[usr, bin, x86_64-linux-gnu-ar]: 2
@[lib, x86_64-linux-gnu, libreadline.so.6.3]: 2
@[usr, bin, x86_64-linux-gnu-objcopy]: 2
[...]
@[usr, bin, make]: 226
@[lib, x86_64-linux-gnu, libz.so.1.2.8]: 296
@[x86_64-linux-gnu, gconv, gconv-modules.cache]: 365
@[/, bin, bash]: 670
@[lib, x86_64-linux-gnu, libtinfo.so.5.9]: 672
@[/, bin, cat]: 1152
@[lib, x86_64-linux-gnu, libdl-2.23.so]: 1240
@[lib, locale, locale-archive]: 1424
@[/, etc, ld.so.cache]: 1449
@[lib, x86_64-linux-gnu, ld-2.23.so]: 2879
@[lib, x86_64-linux-gnu, libc-2.23.so]: 2879
@[, , ]: 8384

This example has traced a software build. Each file is shown by the filename and two parent directories. The last entry in the output above has no names: it is anonymous mappings for program private data.

The source to mmapfiles(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/mm.h>

kprobe:do_mmap
{
        $file = (struct file *)arg0;
        $name = $file->f_path.dentry;
        $dir1 = $name->d_parent;
        $dir2 = $dir1->d_parent;
        @[str($dir2->d_name.name), str($dir1->d_name.name),
            str($name->d_name.name)] = count();
}

It uses kprobes to trace the kernel do_mmap() function, and reads the filename from its struct file * argument, via a struct dentry (directory entry). The dentry only has one component of the path name, so to provide more context on where this file is located, the parent directory and grandparent directory are read and included in the output.10 Since the mmap() call is expected to be relatively infrequent, the overhead of this tool is expected to be negligible.

10 I’ve suggested adding a BPF kernel helper that takes a struct file or struct dentry, and returns the full path, similar to the kernel d_path().

The aggregation key can be easily modified to include the process name, to show who is making these mappings (“@[comm, ...]”), and the user-level stack as well to show the code path (“@[comm, ustack, ...]”).

Chapter 7 includes a per-event mmap() analysis tool: mmapsnoop(8).

8.3.5 scread
scread(8)11 traces the read(2) system call and shows the filename it is operating on. For example:

11 Origin: I created it for this book on 26-Jan-2019.

Click here to view code image


# scread.bt
Attaching 1 probe...
^C

@filename[org.chromium.BkPmzg]: 1
@filename[locale.alias]: 2
@filename[chrome_200_percent.pak]: 4
@filename[passwd]: 7
@filename[17]: 44
@filename[scriptCache-current.bin]: 48
[...]

This shows the “scriptCache-current.bin” file was read(2) 48 times while tracing. This is a syscall-based view into file I/O; see the later filetop(8) tool for a VFS-level view. These tools help characterize file usage, so you can look for inefficiencies.

The source to scread(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/sched.h>
#include <linux/fs.h>
#include <linux/fdtable.h>

tracepoint:syscalls:sys_enter_read
{
        $task = (struct task_struct *)curtask;
        $file = (struct file *)*($task->files->fdt->fd + args->fd);
        @filename[str($file->f_path.dentry->d_name.name)] = count();
}

This pulls the filename from the file descriptor table.

File Descriptor to Filename
This tool has also been included as an example of fetching the filename from a file descriptor (FD) integer. There are at least two ways to do this:

Walk from the task_struct to the file descriptor table, and use the FD as the index to find the struct file. The filename can then be found from this struct. This is used by scread(2). This is an unstable technique: the way the file descriptor table is found (task->files->fdt->fd) refers to kernel internals that may change between kernel versions, which would break this script.12

12 Some changes are already being considered. Dave Watson has been considering rearranging it to improve performance. Matthew Wilox is also working on changing it to task_struct->files_struct->maple_node->fd[i]. [85] [86]

Trace the open(2) syscall(s), and build a lookup hash with the PID and FD as the keys, and the file/pathname as the value. This can then be queried during read(2) and other syscalls. While this adds additional probes (and overhead), it is a stable technique.

There are many other tools in this book (fmapfault(8), filelife(8), vfssize(8), etc.) that refer to the filename for different operations; however, those work by tracing via the VFS layer, which provides the struct file immediately. While that is also an unstable interface, it makes it possible to find the filename string in fewer steps. Another advantage of VFS tracing is that there is usually only one function per type of operation, whereas with syscalls there can be variants (e.g., read(2), readv(2), preadv(2), pread64(), etc.) that may all need to be traced.

8.3.6 fmapfault
fmapfault(8)13 traces page faults for memory mapped files, and counts the process name and filename. For example:

13 Origin: I created it for this book on 26-Jan-2019.

Click here to view code image


# fmapfault.bt
Attaching 1 probe...
^C

@[dirname, libc-2.23.so]: 1
@[date, libc-2.23.so]: 1
[...]
@[cat, libc-2.23.so]: 901
@[sh, libtinfo.so.5.9]: 962
@[sed, ld-2.23.so]: 984
@[sh, libc-2.23.so]: 997
@[cat, ld-2.23.so]: 1252
@[sh, ld-2.23.so]: 1427
@[as, libbfd-2.26.1-system.so]: 3984
@[as, libopcodes-2.26.1-system.so]: 68455

This traced a software build, and shows the build processes and libraries in which they were faulting.

Later tools in this book, such as filetop(8), fileslower(8), xfsslower(8), and ext4dist(8), show file I/O via the read(2) and write(2) syscalls (and their variants). But these are not the only way that files can be read and written to: file mappings are another method, which avoids explicit syscalls. fmapfault(8) provides a view of their use, by tracing file page faults and the creation of new page maps. Note that the actual reads and writes to a file may be far higher than the fault rate.

The source to fmapfault(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/mm.h>

kprobe:filemap_fault
{
        $vf = (struct vm_fault *)arg0;
        $file = $vf->vma->vm_file->f_path.dentry->d_name.name;
        @[comm, str($file)] = count();
}

This works by using kprobes to trace the filemap_fault() kernel function and, from its struct vm_fault argument, determine the filename for the mapping. These details will need to be updated as the kernel changes. The overhead of this tool may be noticeable for systems with high fault rates.

8.3.7 filelife
filelife(8)14 is a BCC and bpftrace tool to show the lifespan of short-lived files: those that were created and then deleted while tracing.

14 Origin: I first created it for BCC on 8-Feb-2015 to debug short-lived file usage, and for bpftrace for this book on 31-Jan-2019. It’s inspired by my vfslife.d tool from the 2011 DTrace book [Gregg 11].

The following shows filelife(8) from BCC, during a software build:

Click here to view code image


# filelife
TIME     PID    COMM             AGE(s)  FILE
17:04:51 3576   gcc              0.02    cc9JENsb.s
17:04:51 3632   rm               0.00    kernel.release.tmp
17:04:51 3656   rm               0.00    version.h.tmp
17:04:51 3678   rm               0.00    utsrelease.h.tmp
17:04:51 3698   gcc              0.01    ccTtEADr.s
17:04:51 3701   rm               0.00    .3697.tmp
17:04:51 736    systemd-udevd    0.00    queue
17:04:51 3703   gcc              0.16    cc05cPSr.s
17:04:51 3708   rm               0.01    .purgatory.o.d
17:04:51 3711   gcc              0.01    ccgk4xfE.s
17:04:51 3715   rm               0.01    .stack.o.d
17:04:51 3718   gcc              0.01    ccPiKOgD.s
17:04:51 3722   rm               0.01    .setup-x86_64.o.d
[...]

This output shows the many short-lived files created during the build process, which were removed at an age (“AGE(s)”) of less than one second.

This tool has been used to find some small performance wins: discovering cases where applications were using temporary files which could be avoided.

This works by using kprobes to trace file creation and deletion via the VFS calls vfs_create() and vfs_unlink(). The overhead of this tool should be negligible as the rate of these should be relatively low.

BCC
Command line usage:

filelife [options]
Options include:

-p PID: Measure this process only

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

BEGIN
{
        printf("%-6s %-16s %8s %s\n", "PID", "COMM", "AGE(ms)", "FILE");
}

kprobe:vfs_create,
kprobe:security_inode_create
{
        @birth[arg1] = nsecs;
}

kprobe:vfs_unlink
/@birth[arg1]/
{
        $dur = nsecs - @birth[arg1];
        delete(@birth[arg1]);
        $dentry = (struct dentry *)arg1;
        printf("%-6d %-16s %8d %s\n", pid, comm, $dur / 1000000,
            str($dentry->d_name.name));
}

Newer kernels may not use vfs_create(), so file creation can also be fetched via security_inode_create(), the access-control hook (LSM) for inode creation (if both events occur for the same file, then the birth timestamp is overwritten, but this should not noticeably affect the file lifespan measurement). The birth timestamp is stored keyed on arg1 of those functions, which is the struct dentry pointer, and is used as a unique ID. The filename is also fetched from struct dentry.

8.3.8 vfsstat
vfsstat(8)15 is a BCC and bpftrace tool to summarize statistics for some common VFS calls: reads and writes (I/O), creates, opens, and fsyncs. This provides the highest-level workload characterization of virtual file system operations. The following shows vfsstat(8) from BCC on a 36-CPU production Hadoop server:

15 Origin: I first created this for BCC on 14-Aug-2015 and for bpftrace on 6-Sep-2018.

Click here to view code image


# vfsstat
TIME         READ/s  WRITE/s CREATE/s   OPEN/s  FSYNC/s
02:41:23:   1715013    38717        0     5379        0
02:41:24:    947879    30903        0    10547        0
02:41:25:   1064800    34387        0    57883        0
02:41:26:   1150847    36104        0     5105        0
02:41:27:   1281686    33610        0     2703        0
02:41:28:   1075975    31496        0     6204        0
02:41:29:    868243    34139        0     5090        0
02:41:30:    889394    31388        0     2730        0
02:41:31:   1124013    35483        0     8121        0
17:21:47:     11443     7876        0      507        0
[...]

This output shows a workload reaching over one million reads/second. A surprising detail is the number of file opens per second: over five thousand. These are a slower operation, requiring path name lookups by the kernel and creating file descriptors, plus additional file metadata structs if they weren’t already cached. This workload can be investigated further using opensnoop(8) to find ways to reduce the number of opens.

vfsstat(8) works by using kprobes for the functions: vfs_read(), vfs_write(), vfs_fsync(), vfs_open(), and vfs_create(), and printing them as per-second summaries in a table. VFS functions can be very frequent, as shown by this real-world example and, at rates of over one million events per second, the overhead of this tool is expected to be measurable (e.g., 1–3% at this rate). This tool is suited for ad hoc investigations, not 24x7 monitoring, where we’d prefer the overhead to be less than 0.1%.

This tool is only useful for the beginning of your investigation. VFS operations include file systems and networking, and you will need to drill down using other tools (e.g., the following vfssize(8)) to differentiate between them.

BCC
Command line usage:

Click here to view code image

vfsstat [interval [count]]
This is modeled on other traditional tools (vmstat(1)).

bpftrace
There is a bpftrace version of vfsstat(8) which prints the same data:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing key VFS calls... Hit Ctrl-C to end.\n");
}

kprobe:vfs_read*,
kprobe:vfs_write*,
kprobe:vfs_fsync,
kprobe:vfs_open,
kprobe:vfs_create
{
        @[func] = count();
}

interval:s:1
{
        time();
        print(@);
        clear(@);
}

END
{
        clear(@);
}

This outputs every one second, formatted as a list of counts. Wildcards have been used to match variants of vfs_read() and vfs_write(): vfs_readv(), etc. If desired, this could be enhanced to use positional parameters to allow a custom interval to be specified.

8.3.9 vfscount
Instead of these five VFS functions counted by vfsstat(8), you can count all of them (there are over 50) and print a frequency count of their calls using the vfscount(8)16 tool in BCC and bpftrace. For example, from BCC:

16 Origin: I first created this for BCC on 14-Aug-2015 and bpftrace on 6-Sep-2018.

Click here to view code image


# vfscount
Tracing... Ctrl-C to end.
^C
ADDR             FUNC                          COUNT
ffffffffb8473d01 vfs_fallocate                     1
ffffffffb849d301 vfs_kern_mount                    1
ffffffffb84b0851 vfs_fsync_range                   2
ffffffffb8487271 vfs_mknod                         3
ffffffffb8487101 vfs_symlink                      68
ffffffffb8488231 vfs_unlink                      376
ffffffffb8478161 vfs_writev                      525
ffffffffb8486d51 vfs_rmdir                       638
ffffffffb8487971 vfs_rename                      762
ffffffffb84874c1 vfs_mkdir                       768
ffffffffb84a2d61 vfs_getxattr                    894
ffffffffb84da761 vfs_lock_file                  1601
ffffffffb848c861 vfs_readlink                   3309
ffffffffb84b2451 vfs_statfs                    18346
ffffffffb8475ea1 vfs_open                     108173
ffffffffb847dbf1 vfs_statx_fd                 193851
ffffffffb847dc71 vfs_statx                    274022
ffffffffb847dbb1 vfs_getattr                  330689
ffffffffb847db21 vfs_getattr_nosec            331766
ffffffffb84790a1 vfs_write                    355960
ffffffffb8478df1 vfs_read                     712610

While tracing, vfs_read() was most frequent with 712,610 calls, and vfs_fallocate() was called once. The overhead of this tool, like vfsstat(8), can become noticeable at high rates of VFS calls.

Its functionality can also be implemented using funccount(8) from BCC, and bpftrace(8) directly:

Click here to view code image


# funccount 'vfs_*'
# bpftrace -e 'kprobe:vfs_* { @[func] = count(); }'

Counting VFS calls like this is only useful as a high-level view, before digging deeper. These calls can be for any subsystem that operates via VFS, including sockets (networking), /dev files, and /proc. The fsrwstat(8) tool, covered next, shows one way to separate these types.

8.3.10 vfssize
vfssize(8)17 is a bpftrace tool that shows VFS read and write sizes as histograms, broken down by process name and VFS filename or type. Example output from a 48-CPU production API server:

17 Origin: I created it for this book on 17-Apr-2019.

Click here to view code image


# vfssize
Attaching 5 probes...

@[tomcat-exec-393, tomcat_access.log]:
[8K, 16K)             31 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

[...]

@[kafka-producer-, TCP]:
[4, 8)              2061 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[8, 16)                0 |                                                    |
[16, 32)               0 |                                                    |
[32, 64)            2032 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ |

@[EVCACHE_..., FIFO]:
[1]                 6376 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

[...]
@[grpc-default-wo, TCP]:
[4, 8)               101 |                                                    |
[8, 16)            12062 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16, 32)            8217 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[32, 64)            7459 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                    |
[64, 128)           5488 |@@@@@@@@@@@@@@@@@@@@@@@                             |
[128, 256)          2567 |@@@@@@@@@@@                                         |
[256, 512)         11030 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@     |
[512, 1K)           9022 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@              |
[1K, 2K)            6131 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[2K, 4K)            6276 |@@@@@@@@@@@@@@@@@@@@@@@@@@@                         |
[4K, 8K)            2581 |@@@@@@@@@@@                                         |
[8K, 16K)            950 |@@@@                                                |

@[grpc-default-wo, FIFO]:
[1]               266897 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

This highlights how VFS handles networking and FIFO as well. Processes named “grpc-default-wo” (truncated) did 266,897 one-byte reads or writes while tracing: this sounds like an opportunity for a performance optimization, by increasing the I/O size. The same process names also performed many TCP reads and writes, with a bi-modal distribution of sizes. The output has only a single example of a file system file, “tomcat_access.log,” with 31 total reads and writes by tomcat-exec-393.

Source for vfssize(8):

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

kprobe:vfs_read,
kprobe:vfs_readv,
kprobe:vfs_write,
kprobe:vfs_writev
{
        @file[tid] = arg0;
}

kretprobe:vfs_read,
kretprobe:vfs_readv,
kretprobe:vfs_write,
kretprobe:vfs_writev
/@file[tid]/
{
        if (retval >= 0) {
                $file = (struct file *)@file[tid];
                $name = $file->f_path.dentry->d_name.name;
                if ((($file->f_inode->i_mode >> 12) & 15) == DT_FIFO) {
                        @[comm, "FIFO"] = hist(retval);
                } else {
                        @[comm, str($name)] = hist(retval);
                }
        }
        delete(@file[tid]);
}

END
{
        clear(@file);
}

This fetches the struct file from the first argument to vfs_read(), vfs_readv(), vfs_write(), and vfs_writev(), and gets the resulting size from the kretprobe. Fortunately, for network protocols, the protocol name is stored in the filename. (This originates from struct proto: see Chapter 10 for more about this.) For FIFOs, there is nothing currently stored in the filename, so the text “FIFO” is hardcoded in this tool.

vfssize(8) can be enhanced to include the type of call (read or write) by adding “probe” as a key, the process ID (“pid”), and other details as desired.

8.3.11 fsrwstat
fsrwstat(8)18 shows how to customize vfsstat(8) to include the file system type. Example output:

18 Origin: I created it for this book on 1-Feb-2019, inspired by my fsrwcount.d tool from the 2011 DTrace book [Gregg 11].

Click here to view code image


# fsrwstat
Attaching 7 probes...
Tracing VFS reads and writes... Hit Ctrl-C to end.

18:29:27
@[sockfs, vfs_write]: 1
@[sysfs, vfs_read]: 4
@[sockfs, vfs_read]: 5
@[devtmpfs, vfs_read]: 57
@[pipefs, vfs_write]: 156
@[pipefs, vfs_read]: 160
@[anon_inodefs, vfs_read]: 164
@[sockfs, vfs_writev]: 223
@[anon_inodefs, vfs_write]: 292
@[devpts, vfs_write]: 2634
@[ext4, vfs_write]: 104268
@[ext4, vfs_read]: 10495

[...]

This shows the different file system types as the first column, separating socket I/O from ext4 file system I/O. This particular output shows a heavy (over 100,000 IOPS) ext4 read and write workload.

Source for fsrwstat(8):

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

BEGIN
{
        printf("Tracing VFS reads and writes... Hit Ctrl-C to end.\n");
}

kprobe:vfs_read,
kprobe:vfs_readv,
kprobe:vfs_write,
kprobe:vfs_writev
{
        @[str(((struct file *)arg0)->f_inode->i_sb->s_type->name), func] =
            count();
}

interval:s:1
{
        time(); print(@); clear(@);
}

END
{
        clear(@);
}

The program traces four VFS functions and frequency counts the file system type and the function name. Since struct file * is the first argument to these functions, it can be cast from arg0, and then members walked until the file system type name is read. The path walked is file -> inode -> superblock -> file_system_type -> name. Because it uses kprobes, this path is an unstable interface, and will need to be updated to match kernel changes.

fsrwstat(8) can be enhanced to include other VFS calls, so long as there is a path to the file system type from the instrumented function arguments (from arg0, or arg1, or arg2, etc.).

8.3.12 fileslower
fileslower(8)19 is a BCC and bpftrace tool to show synchronous file reads and writes slower than a given threshold. The following shows fileslower(8) from BCC, tracing reads/writes slower than 10 milliseconds (the default threshold), on a 36-CPU production Hadoop server:

19 Origin: I first created this for BCC on 6-Feb-2016, and the bpftrace version for this book on 31-Jan-2019.

Click here to view code image


# fileslower
Tracing sync read/writes slower than 10 ms
TIME(s)  COMM         TID    D BYTES   LAT(ms) FILENAME
0.142    java         111264 R 4096      25.53 part-00762-37d00f8d...
0.417    java         7122   R 65536     22.80 file.out.index
1.809    java         70560  R 8192      21.71 temp_local_3c9f655b...
2.592    java         47861  W 64512     10.43 blk_2191482458
2.605    java         47785  W 64512     34.45 blk_2191481297
4.454    java         47799  W 64512     24.84 blk_2191482039
4.987    java         111264 R 4096      10.36 part-00762-37d00f8d...
5.091    java         47895  W 64512     15.72 blk_2191483348
5.130    java         47906  W 64512     10.34 blk_2191484018
5.134    java         47799  W 504       13.73 blk_2191482039_1117768266.meta
5.303    java         47984  R 30        12.50 spark-core_2.11-2.3.2...
5.383    java         47899  W 64512     11.27 blk_2191483378
5.773    java         47998  W 64512     10.83 blk_2191487052
[...]

This output shows a Java process encountering writes as slow as 34 milliseconds, and displays the names of the files read and written. The direction is the “D” column: “R” for read or “W” for write. The “TIME(s)” column reveals that these slow reads and writes were not very frequent—only a few per second.

Synchronous reads and writes are important as processes block on them and suffer their latency directly. The introduction to this chapter discussed how file system analysis can be more relevant than disk I/O analysis, and this is an example case. In the next chapter, disk I/O latency will be measured, but at that level, applications may not be directly affected by latency issues. With disk I/O, it’s easy to find phenomena that look like problems of latency but aren’t really problems at all. However, if fileslower(8) shows a latency problem, it’s probably an actual problem.

Synchronous reads and writes will block a process. It is likely—but not certain—that this also causes application-level problems. The application could be using a background I/O thread for write flushing and cache warming, which is performing synchronous I/O but without an application request blocking on it.

This tool has been used to prove production latency originated from the file system, and in other cases exonerate the file system: showing no I/O was slow as was assumed.

fileslower(8) works by tracing the synchronous read and write codepath from VFS. The current implementation traces all VFS reads and writes and then filters on those that are synchronous, so the overhead may be higher than expected.

BCC
Command line usage:

Click here to view code image

fileslower [options] [min_ms]
Options include:

-p PID: Measure this process only

The min_ms argument is the minimum time in milliseconds. If 0 is provided, then all synchronous reads and writes are printed out. This output may be thousands of lines per second, depending on their rate, and unless you have a good reason to see them all, that’s not likely something you want to do. A default of 10 milliseconds is used if no argument is provided.

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

BEGIN
{
        printf("%-8s %-16s %-6s T %-7s %7s %s\n", "TIMEms", "COMM", "PID",
            "BYTES", "LATms", "FILE");
}

kprobe:new_sync_read,
kprobe:new_sync_write
{
        $file = (struct file *)arg0;
        if ($file->f_path.dentry->d_name.len != 0) {
                @name[tid] = $file->f_path.dentry->d_name.name;
                @size[tid] = arg2;
                @start[tid] = nsecs;
        }
}

kretprobe:new_sync_read
/@start[tid]/
{
        $read_ms = (nsecs - @start[tid]) / 1000000;
        if ($read_ms >= 1) {
                printf("%-8d %-16s %-6d R %-7d %7d %s\n", nsecs / 1000000,
                    comm, pid, @size[tid], $read_ms, str(@name[tid]));
        }
        delete(@start[tid]); delete(@size[tid]); delete(@name[tid]);
}

kretprobe:new_sync_write
/@start[tid]/
{
        $write_ms = (nsecs - @start[tid]) / 1000000;
        if ($write_ms >= 1) {
                printf("%-8d %-16s %-6d W %-7d %7d %s\n", nsecs / 1000000,
                    comm, pid, @size[tid], $write_ms, str(@name[tid]));
        }
        delete(@start[tid]); delete(@size[tid]); delete(@name[tid]);
}

END
{
        clear(@start); clear(@size); clear(@name);
}

This uses kprobes to trace the new_sync_read() and new_sync_write() kernel functions. As kprobes is an unstable interface, there’s no guarantee that these will work across different kernel versions, and I’ve already encountered kernels where they are not available for tracing (inlined). The BCC version employs the workaround, by tracing higher-level __vfs_read() and __vfs_write() internal functions and then filtering for those that are synchronous.

8.3.13 filetop
filetop(8)20 is BCC tool that is like top(1) for files, showing the most frequently read or written filenames. Example output on a 36-CPU production Hadoop server:

20 Origin: I created this for BCC on 6-Feb-2016, inspired by top(1) by William LeFebvre.

Click here to view code image


# filetop
Tracing... Output every 1 secs. Hit Ctrl-C to end

02:31:38 loadavg: 39.53 36.71 32.66 26/3427 30188

TID    COMM             READS  WRITES R_Kb    W_Kb    T FILE
113962 java             15171  0      60684   0       R part-00903-37d00f8d-ecf9-4...
23110  java             7      0      7168    0       R temp_local_6ba99afa-351d-4...
25836  java             48     0      3072    0       R map_4141.out
26890  java             46     0      2944    0       R map_5827.out
26788  java             42     0      2688    0       R map_4363.out
26788  java             18     0      1152    0       R map_4756.out.merged
70560  java             130    0      1085    0       R temp_local_1bd4386b-b33c-4...
70560  java             130    0      1079    0       R temp_local_a3938a84-9f23-4...
70560  java             127    0      1053    0       R temp_local_3c9f655b-06e4-4...
26890  java             16     0      1024    0       R map_11374.out.merged
26890  java             15     0      960     0       R map_5262.out.merged
26788  java             15     0      960     0       R map_20423.out.merged
26788  java             14     0      896     0       R map_4371.out.merged
26890  java             14     0      896     0       R map_10138.out.merged
26890  java             13     0      832     0       R map_4991.out.merged
25836  java             13     0      832     0       R map_3994.out.merged
25836  java             13     0      832     0       R map_4651.out.merged
25836  java             13     0      832     0       R map_16267.out.merged
25836  java             13     0      832     0       R map_15255.out.merged
26788  java             12     0      768     0       R map_6917.out.merged
[...]

By default, the top twenty files are shown, sorted by the read bytes column, and the screen redraws every second. This particular output shows that a “part-00903-37d00f8d” file (filename truncated) had the most read bytes at around 60 Mbytes during that one-second interval, from about 15k reads. Not shown is the average read size, but that can be calculated from those numbers to be 4.0 Kbytes.

This tool is used for workload characterization and general file system observability. Just as you can discover an unexpected CPU-consuming process using top(1), this may help you discover an unexpected I/O-busy file.

filetop by default also only shows regular files.21 The -a option shows all files, including TCP sockets:

21 “regular” refers to the file type: DT_REG in the kernel source. Other file types include DT_DIR for directories, DT_BLK for block special devices, etc.

Click here to view code image


# filetop -a
[...]
TID    COMM             READS  WRITES R_Kb    W_Kb    T FILE
32857  java             718    0      15756   0       S TCP
120597 java             12     0      12288   0       R temp_local_3807d4ca-b41e-3...
32770  java             502    0      10118   0       S TCP
32507  java             199    0      4212    0       S TCP
88371  java             186    0      1775    0       R temp_local_215ae692-35a4-2...
[...]

The columns are:

TID: Thread ID

COMM: Process/thread name

READS: Number of reads during interval

WRITES: Number of writes during interval

R_Kb: Total read Kbytes during interval

W_Kb: Total write Kbytes during interval

T: Type: R == Regular file, S == Socket, O == Other

FILE: Filename

This works by using kprobes to trace the vfs_read() and vfs_write() kernel functions. The file type is read from the inode mode, via the S_ISREG() and S_ISSOCK() macros.

The overhead of this tool, like earlier ones, can begin to be noticeable because VFS reads/writes can be frequent. This also traces various statistics, including the filename, which makes its overhead a little higher than for other tools.

Command line usage:

filetop [options] [interval [count]]
Options include:

-C: Don’t clear the screen: rolling output

-r ROWS: Print this many rows (default 20)

-p PID: Measure this process only

The -C option is useful for preserving the terminal’s scroll-back buffer, so that patterns over time can be examined.

8.3.14 writesync
writesync(8)22 is a bpftrace tool that traces VFS writes to regular files and shows which were using a synchronous write flag (O_SYNC or O_DSYNC). For example:

22 Origin: I created it for this book on 19-May-2019.

Click here to view code image


# writesync.bt
Attaching 2 probes...
Tracing VFS write sync flags... Hit Ctrl-C to end.
^C

@regular[cronolog, output_20190520_06.log]: 1
@regular[VM Thread, gc.log]: 2
@regular[cronolog, catalina_20190520_06.out]: 9
@regular[tomcat-exec-142, tomcat_access.log]: 15
[...]

@sync[dd, outfile]: 100

This output shows shows a number of regular writes to files, and one hundred writes from a “dd” process to a file called “outfile1.” The dd(1) was an artificial test using:

Click here to view code image

dd if=/dev/zero of=outfile oflag=sync count=100
Synchronous writes must wait for the storage I/O to complete (write through), unlike normal I/O which can complete from cache (write-back). This makes synchronous I/O slow, and if the synchronous flag is unnecessary, removing it can greatly improve performance.

The source to writesync(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>
#include <asm-generic/fcntl.h>

BEGIN
{
        printf("Tracing VFS write sync flags... Hit Ctrl-C to end.\n");
}

kprobe:vfs_write,
kprobe:vfs_writev
{
        $file = (struct file *)arg0;
        $name = $file->f_path.dentry->d_name.name;
        if ((($file->f_inode->i_mode >> 12) & 15) == DT_REG) {
                if ($file->f_flags & O_DSYNC) {
                        @sync[comm, str($name)] = count();
                } else {
                        @regular[comm, str($name)] = count();
                }
        }
}

This checks that the file is a regular file (DT_REG), and then checks for the presence of the O_DSYNC flag (which is also set by O_SYNC).

8.3.15 filetype
filetype(8)23 is a bpftrace tool that traces VFS reads and writes along with the type of the file and process name. For example, on a 36-CPU system during a software build:

23 Origin: I created it for this book on 2-Feb-2019.

Click here to view code image


# filetype.bt
Attaching 4 probes...
^C

@[regular, vfs_read, expr]: 1
@[character, vfs_read, bash]: 10
[...]
@[socket, vfs_write, sshd]: 435
@[fifo, vfs_write, cat]: 464
@[regular, vfs_write, sh]: 697
@[regular, vfs_write, as]: 785
@[regular, vfs_read, objtool]: 932
@[fifo, vfs_read, make]: 1033
@[regular, vfs_read, as]: 1437
@[regular, vfs_read, gcc]: 1563
@[regular, vfs_read, cat]: 2196
@[regular, vfs_read, sh]: 8391
@[regular, vfs_read, fixdep]: 11299
@[fifo, vfs_read, sh]: 15422
@[regular, vfs_read, cc1]: 16851
@[regular, vfs_read, make]: 39600

This output shows that most of the file types were “regular”, for normal files, which were read and written by build software (make(1), cc1(1), gcc(1), etc.). The output also includes socket writes for sshd, which is the SSH server sending packets, and character reads from bash, which would be the bash shell reading input from the /dev/pts/1 character device.

The output also includes FIFO24 reads and writes. Here’s a short demo to illustrate their role:

24 FIFO: first-in, first-out special file (named pipe). See the FIFO(7) man page.

Click here to view code image


window1$ tar cf - dir1 | gzip > dir1.tar.gz
window2# filetype.bt
Attaching 4 probes...
^C
[...]
@[regular, vfs_write, gzip]: 36
@[fifo, vfs_write, tar]: 191
@[fifo, vfs_read, gzip]: 191
@[regular, vfs_read, tar]: 425

The FIFO type is for shell pipes. Here the tar(1) command is performing reads of regular files, and then writing them to a FIFO. gzip(1) is reading from the FIFO, and writing to a regular file. This is all visible in the output.

The source to filetype(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

BEGIN
{
        // from uapi/linux/stat.h:
        @type[0xc000] = "socket";
        @type[0xa000] = "link";
        @type[0x8000] = "regular";
        @type[0x6000] = "block";
        @type[0x4000] = "directory";
        @type[0x2000] = "character";
        @type[0x1000] = "fifo";
        @type[0] = "other";
}

kprobe:vfs_read,
kprobe:vfs_readv,
kprobe:vfs_write,
kprobe:vfs_writev
{
        $file = (struct file *)arg0;
        $mode = $file->f_inode->i_mode;
        @[@type[$mode & 0xf000], func, comm] = count();
}

END
{
        clear(@type);
}

The BEGIN program sets up a hash table (@type) for inode file modes to strings, which are then looked up in the kprobes for the VFS functions.

Two months after writing this tool, I was developing socket I/O tools and noticed that I had not written a VFS tool to expose the file modes from include/linux/fs.h (DT_FIFO, DT_CHR, etc.). I developed this tool to do it (dropping the “DT_” prefix):

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

BEGIN
{
        printf("Tracing VFS reads and writes... Hit Ctrl-C to end.\n");
        // from include/linux/fs.h:
        @type2str[0] = "UNKNOWN";
        @type2str[1] = "FIFO";
        @type2str[2] = "CHR";
        @type2str[4] = "DIR";
        @type2str[6] = "BLK";
        @type2str[8] = "REG";
        @type2str[10] = "LNK";
        @type2str[12] = "SOCK";
        @type2str[14] = "WHT";
}

kprobe:vfs_read,
kprobe:vfs_readv,
kprobe:vfs_write,
kprobe:vfs_writev
{
        $file = (struct file *)arg0;
        $type = ($file->f_inode->i_mode >> 12) & 15;
        @[@type2str[$type], func, comm] = count();
}

END
{
        clear(@type2str);
}

When I went to add it to this chapter, I discovered I had accidentally written a second version of filetype(8), this time using a different header file for file type lookups. I’ve included the source here as a lesson that sometimes there is more than one way to write these tools.

8.3.16 cachestat
cachestat(8)25 is a BCC tool that shows page cache hit and miss statistics. This can be used to check the hit ratio and efficiency of the page cache, and run while investigating system and application tuning for feedback on cache performance. For example, from a 36-CPU production Hadoop instance:

25 Origin: I first created this as an experimental tool using Ftrace for my perf-tools collection on 28-Dec-2014, while I was on vacation in Yulara, near Uluru, in the outback of Australia [87]. Since it’s so tied to kernel internals, it contains a block comment in the header to describe it as a sand castle: a new kernel version can easily break it and wash it away. Allan McAleavy ported it to BCC on 6-Nov-2015.

Click here to view code image


# cachestat
    HITS   MISSES  DIRTIES HITRATIO   BUFFERS_MB  CACHED_MB
   53401     2755    20953   95.09%           14      90223
   49599     4098    21460   92.37%           14      90230
   16601     2689    61329   86.06%           14      90381
   15197     2477    58028   85.99%           14      90522
   18169     4402    51421   80.50%           14      90656
   57604     3064    22117   94.95%           14      90693
   76559     3777     3128   95.30%           14      90692
   49044     3621    26570   93.12%           14      90743
[...]

This output shows a hit ratio often exceeding 90%. Tuning the system and application to bring this 90% close to 100% can result in very large performance wins (much larger than the 10% difference in hit ratio), as the application more often runs from memory without waiting on disk I/O.

Large-scale cloud databases such as Cassandra, Elasticsearch, and PostgreSQL often make heavy usage of the page cache to ensure that the hot dataset is always live in memory. This means that one of the most important questions in provisioning datastores is if the working set fits into the provisioned memory capacity. Netflix teams managing stateful services use this cachestat(8) tool to help answer this question and inform decisions such as what data compression algorithms to use and if adding more memory to a cluster would actually help performance.

A couple of simple examples can better explain the cachestat(8) output. Here is an idle system, where a one-Gbyte file is created. The -T option is now used to show a timestamp column:

Click here to view code image


# cachestat -T
TIME         HITS   MISSES  DIRTIES HITRATIO   BUFFERS_MB  CACHED_MB
21:06:47        0        0        0    0.00%            9        191
21:06:48        0        0   120889    0.00%            9        663
21:06:49        0        0   141167    0.00%            9       1215
21:06:50      795        0        1  100.00%            9       1215
21:06:51        0        0        0    0.00%            9       1215

The DIRTIES column shows pages being written to the page cache (they are “dirty”), and the CACHED_MB column increases by 1024 Mbytes: the size of the newly created file.

This file is then flushed to disk and dropped from the page cache (this drops all pages from the page cache):

Click here to view code image


# sync
# echo 3 > /proc/sys/vm/drop_caches

Now the file is read twice. This time a cachestat(8) interval of 10 seconds is used:

Click here to view code image


# cachestat -T 10
TIME         HITS   MISSES  DIRTIES HITRATIO   BUFFERS_MB  CACHED_MB
21:08:58      771        0        1  100.00%            8        190
21:09:08    33036    53975       16   37.97%            9        400
21:09:18       15    68544        2    0.02%            9        668
21:09:28      798    65632        1    1.20%            9        924
21:09:38        5    67424        0    0.01%            9       1187
21:09:48     3757    11329        0   24.90%            9       1232
21:09:58     2082        0        1  100.00%            9       1232
21:10:08   268421       11       12  100.00%            9       1232
21:10:18        6        0        0  100.00%            9       1232
21:10:19      784        0        1  100.00%            9       1232

The file is read between 21:09:08 and 21:09:48, seen by the high rate of MISSES, a low HITRATIO, and the increase in the page cache size in CACHED_MB by 1024 Mbytes. At 21:10:08 the file was read the second time, now hitting entirely from the page cache (100%).

cachestat(8) works by using kprobes to instrument these kernel functions:

mark_page_accessed(): For measuring cache accesses

mark_buffer_dirty(): For measuring cache writes

add_to_page_cache_lru(): For measuring page additions

account_page_dirtied(): For measuring page dirties

While this tool provides crucial insight for the page cache hit ratio, it is also tied to kernel implementation details via these kprobes and will need maintenance to work on different kernel versions. Its best use may be simply to show that that such a tool is possible.26

26 When I presented cachestat(8) in my LSFMM keynote, the mm engineers stressed that it will break, and later explained some of the challenges in doing this correctly for future kernels (thanks, Mel Gorman). Some of us, like at Netflix, have it working well enough for our kernels and workloads. But to become a robust tool for everyone, I think either (A) someone needs to spend a few weeks studying the kernel source, trying different workloads, and working with the mm engineers to truly solve it; or perhaps even better, (B) add /proc statistics so this can switch to being a counter-based tool.

These page cache functions can be very frequent: they can be called millions of times a second. The overhead for this tool for extreme workloads can exceed 30%, though for normal workloads it will be much less. You should test in a lab environment and quantify before production use.

Command line usage:

Click here to view code image

cachestat [options] [interval [count]]
There is a -T option to include the timestamp on the output.

There is another BCC tool, cachetop(8),27 that prints the cachestat(8) statistics by process in a top(1)-style display using the curses library.

27 Origin: cachetop(8) was created by Emmanuel Bretelle on 13-Jul-2016.

8.3.17 writeback
writeback(8)28 is a bpftrace tool that shows the operation of page cache write-back: when pages are scanned, when dirty pages are flushed to disk, the type of write-back event, and the duration. For example, on a 36-CPU system:

28 Origin: I created it for bpftrace on 14-Sep-2018.

Click here to view code image


# writeback.bt
Attaching 4 probes...
Tracing writeback... Hit Ctrl-C to end.
TIME      DEVICE   PAGES    REASON           ms
03:42:50  253:1    0        periodic         0.013
03:42:55  253:1    40       periodic         0.167
03:43:00  253:1    0        periodic         0.005
03:43:01  253:1    11268    background       6.112
03:43:01  253:1    11266    background       7.977
03:43:01  253:1    11314    background       22.209
03:43:02  253:1    11266    background       20.698
03:43:02  253:1    11266    background       7.421
03:43:02  253:1    11266    background       11.382
03:43:02  253:1    11266    background       6.954
03:43:02  253:1    11266    background       8.749
03:43:02  253:1    11266    background       14.518
03:43:04  253:1    38836    sync             64.655
03:43:04  253:1    0        sync             0.004
03:43:04  253:1    0        sync             0.002
03:43:09  253:1    0        periodic         0.012
03:43:14  253:1    0        periodic         0.016
[...]

This output begins by showing a periodic write-back every five seconds. These were not writing many pages (0, 40, 0). Then there was a burst of background write-backs, writing tens of thousands of pages, and taking between 6 and 22 milliseconds for each write-back. This is asynchronous page flushing for when the system is running low on free memory. If the timestamps were correlated with application performance problems seen by other monitoring tools (e.g., cloud-wide performance monitoring), this would be a clue that the application problem was caused by file system write-back. The behavior of the write-back flushing is tunable (e.g., sysctl(8) and vm.dirty_writeback_centisecs). A sync write-back occurred at 3:43:04, writing 38,836 pages in 64 milliseconds.

The source to writeback(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing writeback... Hit Ctrl-C to end.\n");
        printf("%-9s %-8s %-8s %-16s %s\n", "TIME", "DEVICE", "PAGES",
            "REASON", "ms");

        // see /sys/kernel/debug/tracing/events/writeback/writeback_start/format
        @reason[0] = "background";
        @reason[1] = "vmscan";
        @reason[2] = "sync";
        @reason[3] = "periodic";
        @reason[4] = "laptop_timer";
        @reason[5] = "free_more_memory";
        @reason[6] = "fs_free_space";
        @reason[7] = "forker_thread";
}

tracepoint:writeback:writeback_start
{
        @start[args->sb_dev] = nsecs;
        @pages[args->sb_dev] = args->nr_pages;
}

tracepoint:writeback:writeback_written
/@start[args->sb_dev]/
{
        $sb_dev = args->sb_dev;
        $s = @start[$sb_dev];
        $lat = $s ? (nsecs - $s) / 1000 : 0;
        $pages = @pages[args->sb_dev] - args->nr_pages;

        time("%H:%M:%S  ");
        printf("%-8s %-8d %-16s %d.%03d\n", args->name, $pages,
            @reason[args->reason], $lat / 1000, $lat % 1000);

        delete(@start[$sb_dev]);
        delete(@pages[$sb_dev]);
}

END
{
        clear(@reason);
        clear(@start);
}

This populates @reason to map the reason identifiers to human-readable strings. The time during write-back is measured, keyed on the device, and all details are printed in the writeback_written tracepoint. The page count is determined by a drop in the args->nr_pages argument, following how the kernel accounts for this (see the wb_writeback() source in fs/fs-writeback.c).

8.3.18 dcstat
dcstat(8)29 is a BCC and bpftrace tool that shows directory entry cache (dcache) statistics. The following shows dcstat(8) from BCC, on a 36-CPU production Hadoop instance:

29 Origin: I first created a similar tool called dnlcstat on 10-Mar-2004 to instrument the Solaris directory name lookup cache, using the kernel Kstat statistics. I created the BCC dcstat(8) on 9-Feb-2016, and the bpftrace version for this book on 26-Mar-2019.

Click here to view code image


# dcstat
TIME         REFS/s   SLOW/s   MISS/s     HIT%
22:48:20:    661815    27942    20814    96.86
22:48:21:    540677    87375    80708    85.07
22:48:22:    271719     4042      914    99.66
22:48:23:    434353     4765       37    99.99
22:48:24:    766316     5860      607    99.92
22:48:25:    567078     7866     2279    99.60
22:48:26:    556771    26845    20431    96.33
22:48:27:    558992     4095      747    99.87
22:48:28:    299356     3785      105    99.96
[...]

This output shows hit ratios of over 99%, and a workload of over 500k references per second. The columns are:

REFS/s: dcache references.

SLOW/s: Since Linux 2.5.11, the dcache has an optimization to avoid cacheline bouncing during lookups of common entries ("/", "/usr") [88]. This column shows when this optimization was not used, and the dcache lookup took the “slow” path.

MISS/s: The dcache lookup failed. The directory entry may still be memory as part of the page cache, but the specialized dcache did not return it.

HIT%: Ratio of hits to references.

This works by using kprobes to instrument the lookup_fast() kernel function, and kretprobes for d_lookup(). The overhead of this tool may become noticeable depending on the workload, since these functions can be frequently called as seen in the example output. Test and quantify in a lab environment.

BCC
Command line usage:

dcstat [interval [count]]
This is modeled on other traditional tools (e.g., vmstat(1)).

bpftrace
Example output from the bpftrace version:

Click here to view code image


# dcstat.bt
Attaching 4 probes...
Tracing dcache lookups... Hit Ctrl-C to end.
      REFS     MISSES  HIT%
    234096      16111   93%
    495104      36714   92%
    461846      36543   92%
    460245      36154   92%
[...]

Source code:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing dcache lookups... Hit Ctrl-C to end.\n");
        printf("%10s %10s %5s%\n", "REFS", "MISSES", "HIT%");
}

kprobe:lookup_fast { @hits++; }
kretprobe:d_lookup /retval == 0/ { @misses++; }

interval:s:1
{
        $refs = @hits + @misses;
        $percent = $refs > 0 ? 100 * @hits / $refs : 0;
        printf("%10d %10d %4d%%\n", $refs, @misses, $percent);
        clear(@hits);
        clear(@misses);
}

END
{
        clear(@hits);
        clear(@misses);
}

This uses a ternary operator to avoid a divide-by-zero condition, in the unlikely case that there were zero hits and misses measured.30

30 Note that BPF does have protections against divide-by-zero [89]; it is still a good idea to check before sending a program to BPF, to avoid being rejected by the BPF verifier.

8.3.19 dcsnoop
dcsnoop(8).31 is a BCC and bpftrace tool to trace directory entry cache (dcache) lookups, showing details on every lookup. The output can be verbose, thousands of lines per second, depending on the lookup rate. The following shows dcsnoop(8) from BCC, with -a to show all lookups:

31 Origin: I first created this as dnlcsnoop using DTrace on 17-Mar-2004, the BCC version on 9-Feb-2016, and the bpftrace version on 8-Sep-2018.

Click here to view code image


# dcsnoop -a
TIME(s)     PID    COMM           T FILE
0.005463    2663   snmpd          R proc/sys/net/ipv6/conf/eth0/forwarding
0.005471    2663   snmpd          R sys/net/ipv6/conf/eth0/forwarding
0.005479    2663   snmpd          R net/ipv6/conf/eth0/forwarding
0.005487    2663   snmpd          R ipv6/conf/eth0/forwarding
0.005495    2663   snmpd          R conf/eth0/forwarding
0.005503    2663   snmpd          R eth0/forwarding
0.005511    2663   snmpd          R forwarding
[...]

This output shows a /proc/sys/net/ipv6/conf/eth0/forwarding path lookup by snmpd, and shows how the path is walked looking up each component. The “T” column is the type: R == reference, M == miss.

This works the same way as dcstat(8), using kprobes. The overhead of this tool is expected to be high for any moderate workload, as it is printing a line of output per event. It is intended to be used for short periods to investigate misses seen in dcstat(8).

BCC
The BCC version supports only one command line option: -a, to show both references and misses. By default, only misses are shown.

bpftrace
The following is the code for the bpftrace version:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>
#include <linux/sched.h>

// from fs/namei.c:
struct nameidata {
        struct path     path;
        struct qstr     last;
        // [...]
};

BEGIN
{
        printf("Tracing dcache lookups... Hit Ctrl-C to end.\n");
        printf("%-8s %-6s %-16s %1s %s\n", "TIME", "PID", "COMM", "T", "FILE");
}

// comment out this block to avoid showing hits:
kprobe:lookup_fast
{
        $nd = (struct nameidata *)arg0;
        printf("%-8d %-6d %-16s R %s\n", elapsed / 1000000, pid, comm,
            str($nd->last.name));
}

kprobe:d_lookup
{
        $name = (struct qstr *)arg1;
        @fname[tid] = $name->name;
}

kretprobe:d_lookup
/@fname[tid]/
{
        if (retval == 0) {
                printf("%-8d %-6d %-16s M %s\n", elapsed / 1000000, pid, comm,
                    str(@fname[tid]));
        }
        delete(@fname[tid]);
}

This program needed to reference the “last” member from the nameidata struct, which was not available in kernel headers, so enough of it was declared in this program to find that member.

8.3.20 mountsnoop
mountsnoop(8)32 is a BCC tool that shows when file systems are mounted. This can be used for troubleshooting, especially for container environments that mount file systems on container startup. Example output:

32 Origin: It was created by Omar Sandoval on 14-Oct-2016.

Click here to view code image


# mountsnoop
COMM             PID     TID     MNT_NS      CALL
systemd-logind   1392    1392    4026531840  mount("tmpfs", "/run/user/116", "tmpfs",
MS_NOSUID|MS_NODEV, "mode=0700,uid=116,gid=65534,size=25778348032") = 0
systemd-logind   1392    1392    4026531840  umount("/run/user/116", MNT_DETACH) = 0
[...]

This output shows systemd-logind performing a mount(2) and umount(2) of a tmpfs at /run/user/116.

This works by tracing the mount(2) and unmount(2) syscalls, using kprobes for the functions that perform these. Since mounts should be an infrequent activity, the overhead of this tool is expected to be negligible.

8.3.21 xfsslower
xfsslower(8)33 is a BCC tool to trace common XFS file system operations; it prints per-event details for those operations that were slower than a given threshold. The operations traced are reads, writes, opens, and fsync.

33 Origin: I created this on 11-Feb-2016, inspired by my zfsslower.d tool from the 2011 DTrace book [Gregg 11].

The following shows xfsslower(8) from BCC tracing these operations slower than 10 milliseconds (the default) from a 36-CPU production instance:

Click here to view code image


# xfsslower
Tracing XFS operations slower than 10 ms
TIME     COMM         PID    T BYTES   OFF_KB   LAT(ms) FILENAME
02:04:07 java         5565   R 63559   360237     17.16 shuffle_2_63762_0.data
02:04:07 java         5565   R 44203   151427     12.59 shuffle_0_12138_0.data
02:04:07 java         5565   R 39911   106647     34.96 shuffle_0_12138_0.data
02:04:07 java         5565   R 65536   340788     14.80 shuffle_2_101288_0.data
02:04:07 java         5565   R 65536   340744     14.73 shuffle_2_103383_0.data
02:04:07 java         5565   R 64182   361925     59.44 shuffle_2_64928_0.data
02:04:07 java         5565   R 44215   108517     12.14 shuffle_0_12138_0.data
02:04:07 java         5565   R 63370   338650     23.23 shuffle_2_104532_0.data
02:04:07 java         5565   R 63708   360777     22.61 shuffle_2_65806_0.data
[...]

This output shows frequent reads by Java that exceed 10 milliseconds.

Similar to fileslower(8), this is instrumenting close to the application, and latency seen here is likely suffered by the application.

This works by using kprobes to trace the kernel functions in the file system’s struct file_operations, which is its interface to VFS. From Linux fs/xfs/xfs_file.c:

Click here to view code image


const struct file_operations xfs_file_operations = {
        .llseek         = xfs_file_llseek,
        .read_iter      = xfs_file_read_iter,
        .write_iter     = xfs_file_write_iter,
        .splice_read    = generic_file_splice_read,
        .splice_write   = iter_file_splice_write,
        .unlocked_ioctl = xfs_file_ioctl,
#ifdef CONFIG_COMPAT
        .compat_ioctl   = xfs_file_compat_ioctl,
#endif
        .mmap           = xfs_file_mmap,
        .mmap_supported_flags = MAP_SYNC,
        .open           = xfs_file_open,
        .release        = xfs_file_release,
        .fsync          = xfs_file_fsync,
        .get_unmapped_area = thp_get_unmapped_area,
        .fallocate      = xfs_file_fallocate,
        .remap_file_range = xfs_file_remap_range,
};

The xfs_file_read_iter() function is traced for reads, and xfs_file_write_iter() for writes, and so on. These functions may change from kernel version to version, and so this tool will need maintenance. The overhead of this tool is relative to the rate of the operations, plus the rate of events printed that exceeded the threshold. The rate of operations for busy workloads can be high enough that the overhead is noticeable, even when there are no operations slower than the threshold so that no output is printed.

Command line usage:

Click here to view code image

xfsslower [options] [min_ms]
Options include:

-p PID: Measure this process only

The min_ms argument is the minimum time in milliseconds. If 0 is provided, then all traced operations are printed out. This output may be thousands of lines per second, depending on their rate, and unless you have a good reason to see them all, it is likely undesirable. A default of 10 milliseconds is used if no argument is provided.

The next tool shows a bpftrace program instrumenting the same functions for latency histograms, rather than per-event output.

8.3.22 xfsdist
xfsdist(8)34 is a BCC and bpftrace tool to instrument the XFS file system and show the distribution of latencies as histograms for common operations: reads, writes, opens, and fsync. The following shows xfsdist(8) from BCC, running on a 36-CPU production Hadoop instance for 10 seconds:

34 Origin: I created this for BCC on 12-Feb-2016 and bpftrace on 8-Sep-2018. The tool is inspired by my 2012 zfsdist.d DTrace tool.

Click here to view code image


# xfsdist 10 1
Tracing XFS operation latency... Hit Ctrl-C to end.

23:55:23:

operation = 'read'
     usecs               : count     distribution
         0 -> 1          : 5492     |*****************************           |
         2 -> 3          : 4384     |***********************                 |
         4 -> 7          : 3387     |******************                      |
         8 -> 15         : 1675     |*********                               |
        16 -> 31         : 7429     |****************************************|
        32 -> 63         : 574      |***                                     |
        64 -> 127        : 407      |**                                      |
       128 -> 255        : 163      |                                        |
       256 -> 511        : 253      |*                                       |
       512 -> 1023       : 98       |                                        |
      1024 -> 2047       : 89       |                                        |
      2048 -> 4095       : 39       |                                        |
      4096 -> 8191       : 37       |                                        |
      8192 -> 16383      : 27       |                                        |
     16384 -> 32767      : 11       |                                        |
     32768 -> 65535      : 21       |                                        |
     65536 -> 131071     : 10       |                                        |

operation = 'write'
     usecs               : count     distribution
         0 -> 1          : 414      |                                        |
         2 -> 3          : 1327     |                                        |
         4 -> 7          : 3367     |**                                      |
         8 -> 15         : 22415    |*************                           |
        16 -> 31         : 65348    |****************************************|
        32 -> 63         : 5955     |***                                     |
        64 -> 127        : 1409     |                                        |
       128 -> 255        : 28       |                                        |

operation = 'open'
     usecs               : count     distribution
         0 -> 1          : 7557     |****************************************|
         2 -> 3          : 263      |*                                       |
         4 -> 7          : 4        |                                        |
         8 -> 15         : 6        |                                        |
        16 -> 31         : 2        |                                        |

This output shows separate histograms for reads, writes, and opens, with counts indicating that the workload is currently write-heavy. The read histogram shows a bi-modal distribution, with many taking less than seven microseconds, and another mode at 16 to 31 microseconds. The speed of both these modes suggested they were served from the page cache. This difference between them may be caused by the size of the data read, or different types of reads that take different code paths. The slowest reads reached the 65- to 131-millisecond bucket: these may be from storage devices, and also involve queueing.

The write histogram showed that most writes were in the 16- to 31-microsecond range: also fast, and likely using write-back buffering.

BCC
Command line usage:

Click here to view code image

xfsdist [options] [interval [count]]
Options include:

-m: Print output in milliseconds (default is microseconds)

-p PID: Measure this process only

The interval and count arguments allow these histograms to be studied over time.

bpftrace
The following is the code for the bpftrace version, which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing XFS operation latency... Hit Ctrl-C to end.\n");
}

kprobe:xfs_file_read_iter,
kprobe:xfs_file_write_iter,
kprobe:xfs_file_open,
kprobe:xfs_file_fsync
{
        @start[tid] = nsecs;
        @name[tid] = func;
}

kretprobe:xfs_file_read_iter,
kretprobe:xfs_file_write_iter,
kretprobe:xfs_file_open,
kretprobe:xfs_file_fsync
/@start[tid]/
{
        @us[@name[tid]] = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
        delete(@name[tid]);
}

END
{
        clear(@start);
        clear(@name);
}

This makes use of the functions from the XFS struct file_operations. Not all file systems have such a simple mapping, as discussed in the next section about ext4.

8.3.23 ext4dist
There is a ext4dist(8)35 tool in BCC that works like xfsdist(8), but for the ext4 file system instead. See the xfsdist(8) section for output and usage.

35 Origin: I created this on 12-Feb-2016, inspired by my 2012 zfsdist.d DTrace tool, and the bpftrace version for this book on 2-Feb-2019.

There is one difference, and it is an example of the difficulty of using kprobes. Here is the ext4_file_operations struct from Linux 4.8:

Click here to view code image


const struct file_operations ext4_file_operations = {
        .llseek         = ext4_llseek,
        .read_iter      = generic_file_read_iter,
        .write_iter     = ext4_file_write_iter,
        .unlocked_ioctl = ext4_ioctl,
[...]

The read function highlighted in bold is generic_file_read_iter(), and not an ext4 specific one. This is a problem: if you trace this generic one, you are also tracing operations from other file system types, and the output will be polluted.

The workaround used was to trace generic_file_read_iter() and examine its arguments to determine if it came from ext4 or not. The BPF code examined the struct kiocb *icb argument in this way, returning from the tracing function if the file system operations were not for ext4:

Click here to view code image


    // ext4 filter on file->f_op == ext4_file_operations
    struct file *fp = iocb->ki_filp;
    if ((u64)fp->f_op != EXT4_FILE_OPERATIONS)
        return 0;

The EXT4_FILE_OPERATIONS was replaced with the actual address of the ext4_file_operations struct, found by reading /proc/kallsyms during program startup. It’s something of a hack, but it works. It comes with the performance cost of tracing all generic_file_read_iter() calls, affecting other file systems that use it, as well as the additional test in the BPF program.

Then came Linux 4.10, which changed the functions used. Now we can examine a real kernel change and its affect on kprobes, instead of hypothetically warning about the possibility. The file_operations struct became:

Click here to view code image


const struct file_operations ext4_file_operations = {
        .llseek         = ext4_llseek,
        .read_iter      = ext4_file_read_iter,
        .write_iter     = ext4_file_write_iter,
        .unlocked_ioctl = ext4_ioctl,
[...]

Compare this to the earlier version. Now there is an ext4_file_read_iter() function that you can trace directly, so you no longer need to tease apart ext4 calls from the generic function.

bpftrace
To celebrate this change, I developed ext4dist(8) for Linux 4.10 and later (until it changes again). Example output:

Click here to view code image


# ext4dist.bt
Attaching 9 probes...
Tracing ext4 operation latency... Hit Ctrl-C to end.
^C

@us[ext4_sync_file]:
[1K, 2K)               2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[2K, 4K)               1 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[4K, 8K)               0 |                                                    |
[8K, 16K)              1 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |

@us[ext4_file_write_iter]:
[1]                   14 |@@@@@@                                              |
[2, 4)                28 |@@@@@@@@@@@@                                        |
[4, 8)                72 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                    |
[8, 16)              114 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16, 32)              26 |@@@@@@@@@@@                                         |
[32, 64)              61 |@@@@@@@@@@@@@@@@@@@@@@@@@@@                         |
[64, 128)              5 |@@                                                  |
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              1 |                                                    |

@us[ext4_file_read_iter]:
[0]                    1 |                                                    |
[1]                    1 |                                                    |
[2, 4)               768 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)               385 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[8, 16)              112 |@@@@@@@                                             |
[16, 32)              18 |@                                                   |
[32, 64)               5 |                                                    |
[64, 128)              0 |                                                    |
[128, 256)           124 |@@@@@@@@                                            |
[256, 512)            70 |@@@@                                                |
[512, 1K)              3 |                                                    |

@us[ext4_file_open]:
[0]                 1105 |@@@@@@@@@@                                          |
[1]                  221 |@@                                                  |
[2, 4)              5377 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)               359 |@@@                                                 |
[8, 16)               42 |                                                    |
[16, 32)               5 |                                                    |
[32, 64)               1 |                                                    |

The histograms are in microseconds, and this output all shows sub-millisecond latencies.

Source:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing ext4 operation latency... Hit Ctrl-C to end.\n");
}

kprobe:ext4_file_read_iter,
kprobe:ext4_file_write_iter,
kprobe:ext4_file_open,
kprobe:ext4_sync_file
{
        @start[tid] = nsecs;
        @name[tid] = func;
}

kretprobe:ext4_file_read_iter,
kretprobe:ext4_file_write_iter,
kretprobe:ext4_file_open,
kretprobe:ext4_sync_file
/@start[tid]/
{
        @us[@name[tid]] = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
        delete(@name[tid]);
}

END
{
        clear(@start);
        clear(@name);
}

The map was named “@us” to decorate the output with the units (microseconds).

8.3.24 icstat
icstat(8)36 traces inode cache references and misses and prints statistics every second. For example:

36 Origin: I created it for this book on 2-Feb-2019. My first inode cache stat tool was inodestat7 on 11-Mar-2004, and I’m sure there were earlier inode stat tools (from memory, the SE Toolkit).

Click here to view code image


# icstat.bt
Attaching 3 probes...
Tracing icache lookups... Hit Ctrl-C to end.
      REFS     MISSES  HIT%
         0          0    0%
     21647          0  100%
     38925      35250    8%
     33781      33780    0%
       815        806    1%
         0          0    0%
         0          0    0%
[...]

This output shows an initial second of hits, followed by a few seconds of mostly misses. The workload was a find /var -ls, to walk inodes and print their details.

The source to icstat(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing icache lookups... Hit Ctrl-C to end.\n");
        printf("%10s %10s %5s\n", "REFS", "MISSES", "HIT%");
}

kretprobe:find_inode_fast
{
        @refs++;
        if (retval == 0) {
                @misses++;
        }
}

interval:s:1
{
        $hits = @refs - @misses;
        $percent = @refs > 0 ? 100 * $hits / @refs : 0;
        printf("%10d %10d %4d%%\n", @refs, @misses, $percent);
        clear(@refs);
        clear(@misses);
}

END
{
        clear(@refs);
        clear(@misses);
}

As with dcstat(8), for the percent calculation a division by zero is avoided by checking whether @refs is zero.

8.3.25 bufgrow
bufgrow(8)37 is a bpftrace tool that provides some insight into operation of the buffer cache. This shows page cache growth for block pages only (the buffer cache, used for block I/O buffers), showing which processes grew the cache by how many Kbytes. For example:

37 Origin: I created it for this book on 3-Feb-2019.

Click here to view code image


# bufgrow.bt
Attaching 1 probe...
^C

@kb[dd]: 101856

While tracing, “dd” processes increased the buffer cache by around 100 Mbytes. This was a synthetic test involving a dd(1) from a block device, during which the buffer cache did grow by 100 Mbytes:

Click here to view code image


# free -wm
          total      used      free    shared   buffers     cache   available
Mem:      70336       471     69328        26         2       534       68928
Swap:         0         0         0
[...]
# free -wm
          total      used      free    shared   buffers     cache   available
Mem:      70336       473     69153        26       102       607       68839
Swap:         0         0         0

The source to bufgrow(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>

kprobe:add_to_page_cache_lru
{
        $as = (struct address_space *)arg1;
        $mode = $as->host->i_mode;
        // match block mode, uapi/linux/stat.h:
        if ($mode & 0x6000) {
                @kb[comm] = sum(4);        // page size
        }
}

This works by using kprobes to instrument the add_to_page_cache_lru() function, and filters on the block type. Since the block type requires a struct cast and dereference, it is tested in an if-statement rather than the probe filter. This is a frequent function, so running this tool can cost noticeable overhead for busy workloads.

8.3.26 readahead
readahead(8)38 traces file system automatic read-ahead (not the readahead(2) syscall) and shows whether the read-ahead pages were used during tracing, and the time between reading the page and its use. For example:

38 Origin: I created it for this book on 3-Feb-2019. I’ve talked about writing this tool for years, and now I’ve finally gotten around to it.

Click here to view code image


# readahead.bt
Attaching 5 probes...
^C
Readahead unused pages: 128

Readahead used page age (ms):
@age_ms:
[1]                 2455 |@@@@@@@@@@@@@@@                                     |
[2, 4)              8424 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)              4417 |@@@@@@@@@@@@@@@@@@@@@@@@@@@                         |
[8, 16)             7680 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@     |
[16, 32)            4352 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[32, 64)               0 |                                                    |
[64, 128)              0 |                                                    |
[128, 256)           384 |@@                                                  |

This shows that during tracing there were 128 pages read ahead but unused (that’s not many). The histogram shows thousands of pages were read and used, mostly within 32 milliseconds. If that time was in the many seconds, it could be a sign that read-ahead is loading too aggressively, and should be tuned.

This tool was created to help analyze read-ahead behavior on Netflix production instances that were using solid state drives, where read ahead is far less useful than it is for rotational disks, and can negatively affect performance. This particular production issue is also described in the biosnoop(8) section in Chapter 9, as biosnoop(8) had previously been used for this analysis.

The source to readahead(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

kprobe:__do_page_cache_readahead    { @in_readahead[tid] = 1; }
kretprobe:__do_page_cache_readahead { @in_readahead[tid] = 0; }

kretprobe:__page_cache_alloc
/@in_readahead[tid]/
{
        @birth[retval] = nsecs;
        @rapages++;
}

kprobe:mark_page_accessed
/@birth[arg0]/
{
        @age_ms = hist((nsecs - @birth[arg0]) / 1000000);
        delete(@birth[arg0]);
        @rapages--;
}

END
{
        printf("\nReadahead unused pages: %d\n", @rapages);
        printf("\nReadahead used page age (ms):\n");
        print(@age_ms); clear(@age_ms);
        clear(@birth); clear(@in_readahead); clear(@rapages);
}

This works by using kprobes to instrument various kernel functions. It sets a per-thread flag during __do_page_cache_readahead(), which is checked during page allocation to know whether the page was for read-ahead. If so, a timestamp is saved for the page, keyed on the page struct address. This is read later on page access, if set, for the time histogram. The count of unused pages is an entropy count of read-ahead page allocations minus their use, for the duration of the program.

If the kernel implementation changes, this tool will need to be updated to match. Also, tracing page functions and storing extra metadata per page will likely add up to significant overhead, as these page functions are frequent. The overhead of this tool may reach 30% or higher on very busy systems. It is intended for short-term analysis.

At the end of Chapter 9, a bpftrace one-liner is shown that can count the ratio of read vs read-ahead block I/O.

8.3.27 Other Tools
Other BPF tools worth mentioning:

ext4slower(8), ext4dist(8): ext4 versions of xfsslower(8) and xfsdist(8), in BCC

btrfsslower(8), btrfsdist(8): btrfs versions of xfsslower(8) and xfsdist(8), in BCC

zfsslower(8), zfsdist(8): zfs versions of xfsslower(8) and xfsdist(8), in BCC

nfsslower(8), nfsdist(8): NFS versions of xfsslower(8) and xfsdist(8), in BCC, for NFSv3 and NFSv4

8.4 BPF ONE-LINERS
These sections show BCC and bpftrace one-liners. Where possible, the same one-liner is implemented using both BCC and bpftrace.

8.4.1 BCC
Trace files opened via open(2) with process name:

Click here to view code image

opensnoop
Trace files created via creat(2) with process name:

Click here to view code image

trace 't:syscalls:sys_enter_creat "%s", args->pathname'
Count newstat(2) calls by filename:

Click here to view code image

argdist -C 't:syscalls:sys_enter_newstat():char*:args->filename'
Count read syscalls by syscall type:

Click here to view code image

funccount 't:syscalls:sys_enter_*read*'
Count write syscalls by syscall type:

Click here to view code image

funccount 't:syscalls:sys_enter_*write*'
Show the distribution of read() syscall request sizes:

Click here to view code image

argdist -H 't:syscalls:sys_enter_read():int:args->count'
Show the distribution of read() syscall read bytes (and errors):

Click here to view code image

argdist -H 't:syscalls:sys_exit_read():int:args->ret'
Count read() syscall errors by error code:

Click here to view code image

argdist -C 't:syscalls:sys_exit_read():int:args->ret:args->ret<0'
Count VFS calls:

Click here to view code image

funccount 'vfs_*'
Count ext4 tracepoints:

Click here to view code image

funccount 't:ext4:*'
Count xfs tracepoints:

Click here to view code image

funccount 't:xfs:*'
Count ext4 file reads by process name and stack trace:

Click here to view code image

stackcount ext4_file_read_iter
Count ext4 file reads by process name and user-level stack only:

Click here to view code image

stackcount -U ext4_file_read_iter
Trace ZFS spa_sync() times:

Click here to view code image

trace -T 'spa_sync "ZFS spa_sync()"'
Count FS reads to storage devices via read_pages, with stacks and process names:

Click here to view code image

stackcount -P read_pages
Count ext4 reads to storage devices, with stacks and process names:

Click here to view code image

stackcount -P ext4_readpages
8.4.2 bpftrace
Trace files opened via open(2) with process name:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_open { printf("%s %s\n", comm,
    str(args->filename)); }'
Trace files created via creat(2) with process name:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_creat { printf("%s %s\n", comm,
    str(args->pathname)); }'
Count newstat(2) calls by filename:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_newstat { @[str(args->filename)] = count(); }'
Count read syscalls by syscall type:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_*read* { @[probe] = count(); }'
Count write syscalls by syscall type:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_*write* { @[probe] = count(); }'
Show the distribution of read() syscall request sizes:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_read { @ = hist(args->count); }'
Show the distribution of read() syscall read bytes (and errors):

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_exit_read { @ = hist(args->ret); }'
Count read() syscall errors by error code:

Click here to view code image

bpftrace -e 't:syscalls:sys_exit_read /args->ret < 0/ { @[- args->ret] = count(); }'
Count VFS calls:

Click here to view code image

bpftrace -e 'kprobe:vfs_* { @[probe] = count(); }'
Count ext4 tracepoints:

Click here to view code image

bpftrace -e 'tracepoint:ext4:* { @[probe] = count(); }'
Count xfs tracepoints:

Click here to view code image

bpftrace -e 'tracepoint:xfs:* { @[probe] = count(); }'
Count ext4 file reads by process name:

Click here to view code image

bpftrace -e 'kprobe:ext4_file_read_iter { @[comm] = count(); }'
Count ext4 file reads by process name and user-level stack:

Click here to view code image

bpftrace -e 'kprobe:ext4_file_read_iter { @[ustack, comm] = count(); }'
Trace ZFS spa_sync() times:

Click here to view code image

bpftrace -e 'kprobe:spa_sync { time("%H:%M:%S ZFS spa_sinc()\n"); }'
Count dcache references by process name and PID:

Click here to view code image

bpftrace -e 'kprobe:lookup_fast { @[comm, pid] = count(); }'
Count FS reads to storage devices via read_pages, with kernel stacks:

Click here to view code image

bpftrace -e 'kprobe:read_pages { @[kstack] = count(); }'
Count ext4 reads to storage devices via read_pages, with kernel stacks:

Click here to view code image

bpftrace -e 'kprobe:ext4_readpages { @[kstack] = count(); }'
8.4.3 BPF One-Liners Examples
Including some sample output, as I did previously for each tool, is also useful for illustrating one-liners. These are some selected one-liners with example output.

Counting Read Syscalls by Syscall Type
Click here to view code image


# funccount -d 10 't:syscalls:sys_enter_*read*'
Tracing 9 functions for "t:syscalls:sys_enter_*read*"... Hit Ctrl-C to end.

FUNC                                    COUNT
syscalls:sys_enter_pread64                  3
syscalls:sys_enter_readlinkat              34
syscalls:sys_enter_readlink               294
syscalls:sys_enter_read               9863782
Detaching...

This example uses -d 10 to run for 10 seconds. This one-liner, and similar ones using “*write*” and “*open*”, are useful for determining which syscall variants are in use, so that they can then be studied. This output is from a 36-CPU production server, which is almost always using read(2), with nearly 10 million calls in the 10 seconds of tracing.

Showing the Distribution of read() Syscall Read Bytes (and Errors)
Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_read { @ = hist(args->ret); }'
Attaching 1 probe...
^C

@:
(..., 0)             279 |                                                    |
[0]                 2899 |@@@@@@                                              |
[1]                15609 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                   |
[2, 4)                73 |                                                    |
[4, 8)               179 |                                                    |
[8, 16)              374 |                                                    |
[16, 32)            2184 |@@@@                                                |
[32, 64)            1421 |@@@                                                 |
[64, 128)           2758 |@@@@@                                               |
[128, 256)          3899 |@@@@@@@@                                            |
[256, 512)          8913 |@@@@@@@@@@@@@@@@@@@                                 |
[512, 1K)          16498 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[1K, 2K)           16170 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[2K, 4K)           19885 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@         |
[4K, 8K)           23926 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[8K, 16K)           9974 |@@@@@@@@@@@@@@@@@@@@@                               |
[16K, 32K)          7569 |@@@@@@@@@@@@@@@@                                    |
[32K, 64K)          1909 |@@@@                                                |
[64K, 128K)          551 |@                                                   |
[128K, 256K)         149 |                                                    |
[256K, 512K)           1 |                                                    |

This output shows a large mode of reads between 512 bytes and 8 Kbytes. It also shows that 15,609 reads returned one byte only, which could be a target for performance optimizations. These can be investigated further by fetching the stack for these one-byte reads like this:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_exit_read /args->ret == 1/ { @[ustack] =
     count(); }'
There were also 2,899 reads of zero bytes, which may be normal based on the target of the read, and if there are no further bytes to read. The 279 events with a negative return value are error codes, which can also be investigated separately.

Counting XFS Tracepoints
Click here to view code image


# funccount -d 10 't:xfs:*'
Tracing 496 functions for "t:xfs:*"... Hit Ctrl-C to end.
FUNC                                    COUNT
xfs:xfs_buf_delwri_queued                   1
xfs:xfs_irele                               1
xfs:xfs_inactive_symlink                    2
xfs:xfs_dir2_block_addname                  4
xfs:xfs_buf_trylock_fail                    5
[...]
xfs:xfs_trans_read_buf                   9548
xfs:xfs_trans_log_buf                   11800
xfs:xfs_buf_read                        13320
xfs:xfs_buf_find                        13322
xfs:xfs_buf_get                         13322
xfs:xfs_buf_trylock                     15740
xfs:xfs_buf_unlock                      15836
xfs:xfs_buf_rele                        20959
xfs:xfs_perag_get                       21048
xfs:xfs_perag_put                       26230
xfs:xfs_file_buffered_read              43283
xfs:xfs_getattr                         80541
xfs:xfs_write_extent                   121930
xfs:xfs_update_time                    137315
xfs:xfs_log_reserve                    140053
xfs:xfs_log_reserve_exit               140066
xfs:xfs_log_ungrant_sub                140094
xfs:xfs_log_ungrant_exit               140107
xfs:xfs_log_ungrant_enter              140195
xfs:xfs_log_done_nonperm               140264
xfs:xfs_iomap_found                    188507
xfs:xfs_file_buffered_write            188759
xfs:xfs_writepage                      476196
xfs:xfs_releasepage                    479235
xfs:xfs_ilock                          581785
xfs:xfs_iunlock                        589775
Detaching...

XFS has so many tracepoints that this output example was truncated to save space. These provide many ways to investigate XFS internals as needed, and get to the bottom of problems.

Counting ext4 Reads to Storage Devices, with Stacks and Process Names
Click here to view code image


# stackcount -P ext4_readpages
Tracing 1 functions for "ext4_readpages"... Hit Ctrl-C to end.
^C

  ext4_readpages
  read_pages
  __do_page_cache_readahead
  filemap_fault
  ext4_filemap_fault
  __do_fault
  __handle_mm_fault
  handle_mm_fault
  __do_page_fault
  async_page_fault
  __clear_user
  load_elf_binary
  search_binary_handler
  __do_execve_file.isra.36
  __x64_sys_execve
  do_syscall_64
  entry_SYSCALL_64_after_hwframe
  [unknown]
    head [28475]
    1

  ext4_readpages
  read_pages
  __do_page_cache_readahead
  ondemand_readahead
  generic_file_read_iter
  __vfs_read
  vfs_read
  kernel_read
  prepare_binprm
  __do_execve_file.isra.36
  __x64_sys_execve
  do_syscall_64
  entry_SYSCALL_64_after_hwframe
  [unknown]
    bash [28475]
    1

Detaching...

This output has only two events, but it was the two I was hoping to capture for an example: the first shows a page fault and how it leads to calling ext4_readpages() and reading from disk (it’s actually from an execve(2) call loading its binary program); the second shows a normal read(2) that reaches ext4_readpages() via readahead functions. They are examples of an address space operations read, and a file operations read. The output also shows how the kernel stack trace can provide more information about an event. These stacks are from Linux 4.18, and may change between Linux kernel versions.

8.5 OPTIONAL EXERCISES
If not specified, these can be completed using either bpftrace or BCC:

Rewrite filelife(8) to use the syscall tracepoints for creat(2) and unlink(2).

What are the pros and cons of switching filelife(8) to these tracepoints?

Develop a version of vfsstat(8) that prints separate rows for your local file system and TCP. (See vfssize(8) and fsrwstat(8).) Mock output:

Click here to view code image


# vfsstatx
TIME          FS   READ/s  WRITE/s CREATE/s   OPEN/s  FSYNC/s
02:41:23:   ext4  1715013    38717        0     5379        0
02:41:23:    TCP     1431     1311        0        5        0
02:41:24:   ext4   947879    30903        0    10547        0
02:41:24:    TCP     1231      982        0        4        0
[...]

Develop a tool to show the ratio of logical file system I/O (via VFS or the file system interface) vs physical I/O (via block tracepoints).

Develop a tool to analyze file descriptor leaks: those that were allocated during tracing but not freed. One possible solution may be to trace the kernel functions __alloc_fd() and __close_fd().

(Advanced) Develop a tool to show file system I/O broken down by mountpoint.

(Advanced, unsolved) Develop a tool to show the time between accesses in the page cache as a distribution. What are the challenges with this tool?

8.6 SUMMARY
This chapter summarizes BPF tools for file system analysis, instrumenting: system calls, VFS calls, file system calls, and file system tracepoints; the operation of write-back and read-ahead; and the page cache, the dentry cache, the inode cache, and the buffer cache. I included tools that show histograms of file system operation latency to identify multi-modal distributions and outliers, to help solve application performance issues.