# process


# 30 secs inspect commands
```
uptime
dmesg | tail
vmstat 1
mpstat -P ALL 1
pidstat 1
iostat -xz 1
free -m
sar -n DEV 1
sar -n TCP,ETCP 1
top
```

* uptime
大概了解目前系統負擔，最後三個數字是 1, 5, 15 分鐘內的負載。
```
$ uptime
 03:16:59 up 17 days,  4:18,  1 user,  load average: 2.74, 2.54, 2.58
```
This is a quick way to view the load averages, which indicate the number of tasks (processes) wanting to run. On Linux systems, these numbers include processes wanting to run on the CPUs, as well as processes blocked in uninterruptible I/O (usually disk I/O). This gives a high-level idea of resource load (or demand), which can then be further explored using other tools.

The three numbers are exponentially damped moving sum averages with a 1-minute, 5-minute, and 15-minute constant. The three numbers give you some idea of how load is changing over time. In the example above, the load averages show a small recent increase.

Load averages can be worth checking when first responding to an issue to see if the issue is still present. In fault-tolerant environments, a server experiencing a performance issue may be automatically removed from service by the time you can log in to take a look. A high 15-minute load average coupled with a low 1-minute load average can be a sign that you logged in too late to catch the issue.

* dmesg | tail
看最近 10 個系統訊息， out of memory, tcp drop 都可以看
```
$ dmesg | tail
[1880957.563150] perl invoked oom-killer: gfp_mask=0x280da, order=0, oom_score_adj=0
[...]
[1880957.563400] Out of memory: Kill process 18694 (perl) score 246 or sacrifice child
[1880957.563408] Killed process 18694 (perl) total-vm:1972392kB, anon-rss:1953348kB,
file-rss:0kB
[2320864.954447] TCP: Possible SYN flooding on port 7001. Dropping request.  Check
SNMP counters.
```

This shows the past 10 system messages, if any. Look for errors that can cause performance issues. The example above includes the out-of-memory killer and TCP dropping a request. The TCP message even points you to the next area for analysis: SNMP counters.

* vmstat 1
```
$ vmstat 1
procs ---------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
34  0    0 200889792  73708 591828    0    0     0     5    6   10 96  1  3  0  0
32  0    0 200889920  73708 591860    0    0     0   592 13284 4282 98  1  1  0  0
32  0    0 200890112  73708 591860    0    0     0     0 9501 2154 99  1  0  0  0
[...]


```
This is the virtual memory statistics tool that originated in BSD, which also shows other system metrics. When invoked with the argument 1, it prints 1-second summaries; be aware that the first line of numbers is the summary since boot (with the exception of the memory counters).

Columns to check:

r: The number of processes running on CPU and waiting for a turn. This provides a better signal than load averages for determining CPU saturation, as it does not include I/O. To interpret: an "r" value greater than the CPU count indicates saturation.

free: Free memory, in Kbytes. If there are too many digits to count, you probably have enough free memory. The free -m command, included in Section 3.3.7 better explains the state of free memory.

si and so: Swap-ins and swap-outs. If these are non-zero, you’re out of memory. These are only in use if swap devices are configured.

us, sy, id, wa, and st: These are breakdowns of CPU time, on average, across all CPUs. They are user time, system time (kernel), idle, wait I/O, and stolen time (by other guests, or, with Xen, the guest’s own isolated driver domain).

The example shows that CPU time is mostly in user mode. This should direct your next steps to analyze the running user-level code using profilers.

* mpstat -P ALL 1
```
[...]
03:16:41 AM  CPU   %usr  %nice  %sys %iowait  %irq  %soft %steal %guest %gnice  %idle
03:16:42 AM  all  14.27   0.00  0.75    0.44  0.00   0.00   0.06   0.00   0.00  84.48
03:16:42 AM    0 100.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00   0.00
03:16:42 AM    1   0.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00 100.00
03:16:42 AM    2   8.08   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  91.92
03:16:42 AM    3  10.00   0.00  1.00    0.00  0.00   0.00   1.00   0.00   0.00  88.00
03:16:42 AM    4   1.01   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  98.99
03:16:42 AM    5   5.10   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  94.90
03:16:42 AM    6  11.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  89.00
03:16:42 AM    7  10.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  90.00
[...]
```
This command prints per-CPU time broken down into states. The output reveals a problem: CPU 0 has hit 100% user time, evidence of a single-thread bottleneck.

Also look out for high %iowait time, which can be explored with disk I/O tools, and high %sys time, which can be explored with syscall and kernel tracing, as well as CPU profiling.

* pidstat 1
```
Linux 4.13.0-19-generic (...)       08/04/2018     _x86_64_     (16 CPU)

03:20:47 AM   UID       PID    %usr %system  %guest    %CPU   CPU  Command
03:20:48 AM     0      1307    0.00    0.98    0.00    0.98     8  irqbalance
03:20:48 AM    33     12178    4.90    0.00    0.00    4.90     4  java
03:20:48 AM    33     12569  476.47   24.51    0.00  500.98     0  java
03:20:48 AM     0    130249    0.98    0.98    0.00    1.96     1  pidstat

03:20:48 AM   UID       PID    %usr %system  %guest    %CPU   CPU  Command
03:20:49 AM    33     12178    4.00    0.00    0.00    4.00     4  java
03:20:49 AM    33     12569  331.00   21.00    0.00  352.00     0  java
03:20:49 AM     0    129906    1.00    0.00    0.00    1.00     8  sshd
03:20:49 AM     0    130249    1.00    1.00    0.00    2.00     1  pidstat
03:20:49 AM   UID       PID    %usr %system  %guest    %CPU   CPU  Command
03:20:50 AM    33     12178    4.00    0.00    0.00    4.00     4  java
03:20:50 AM   113     12356    1.00    0.00    0.00    1.00    11  snmp-pass
03:20:50 AM    33     12569  210.00   13.00    0.00  223.00     0  java
03:20:50 AM     0    130249    1.00    0.00    0.00    1.00     1  pidstat
[...]
```
pidstat(1) shows CPU usage per process. top(1) is a popular tool for this purpose; however, pidstat(1) provides rolling output by default so that variation over time can be seen. This output shows that a Java process is consuming a variable amount of CPU each second; these percentages are summed across all CPUs,1 so 500% is equivalent to five CPUs at 100%.

1 Note that a recent change to pidstat(1) capped percentages to 100% [36]. This led to output that was invalid for multi-threaded applications exceeding 100%. The change was eventually reverted, but be aware in case you encounter the changed version of pidstat(1).

* iostat -xz 1
```
Linux 4.13.0-19-generic (...)       08/04/2018    _x86_64_      (16 CPU)
[...]
avg-cpu:  %user   %nice %system %iowait  %steal   %idle
          22.90    0.00    0.82    0.63    0.06   75.59

Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s    wkB/s avgrq-sz avgqu-sz
   await r_await w_await  svctm  %util
nvme0n1           0.00  1167.00    0.00 1220.00     0.00 151293.00   248.02     2.10
1.72    0.00    1.72   0.21  26.00
nvme1n1           0.00  1164.00    0.00 1219.00     0.00 151384.00   248.37     0.90
0.74    0.00    0.74   0.19  23.60
md0               0.00     0.00    0.00 4770.00     0.00 303113.00   127.09     0.00
0.00    0.00    0.00   0.00   0.00
[...]
```
This tool shows storage device I/O metrics. The output columns for each disk device have line-wrapped here, making it difficult to read.

Columns to check:

r/s, w/s, rkB/s, and wkB/s: These are the delivered reads, writes, read Kbytes, and write Kbytes per second to the device. Use these for workload characterization. A performance problem may simply be due to an excessive load having been applied.

await: The average time for the I/O in milliseconds. This is the time that the application suffers, as it includes both time queued and time being serviced. Larger-than-expected average times can be an indicator of device saturation or device problems.

avgqu-sz: The average number of requests issued to the device. Values greater than one can be evidence of saturation (although devices, especially virtual devices that front multiple back-end disks, typically operate on requests in parallel.)

%util: Device utilization. This is really a busy percentage, showing the time each second that the device was doing work. It does not show utilization in a capacity planning sense, as devices can operate on requests in parallel.2 Values greater than 60% typically lead to poor performance (which should be seen in the await column), although it depends on the device. Values close to 100% usually indicate saturation.

2 This leads to the confusing situation where a device at 100% utilization as reported by iostat(1) may be able to accept a higher workload. It is just reporting that something was busy 100% of the time, but it was not 100% utilized: it could have accepted more work. The %util reported by iostat(1) is especially misleading for volumes backed by a pool of multiple disks, which have an increased ability to run work in parallel.

The output shows a write workload of ~300 Mbytes/sec to the md0 virtual device, which looks like it is backed by both of the nvme0 devices.

* free -m
```
              total        used        free      shared  buff/cache   available
Mem:         122872       39158        3107        1166       80607       81214
Swap:             0           0           0
```
This shows available memory in Mbytes. Check that the available value is not near zero; it shows how much real memory is available in the system, including in the buffer and page caches.3 Having some memory in the cache improves file system performance.

3 The output of free(1) has changed recently. It used to show buffers and cache as separate columns, and it left the available column as an exercise for the end user to calculate. I like the newer version better. The separate buffers and cached columns can be shown by using -w for wide mode.

see https://stackoverflow.com/questions/9724396/understanding-buffers-and-cached-from-free-command

* sar -n DEV 1
```
Linux 4.13.0-19-generic (...)       08/04/2018    _x86_64_      (16 CPU)

03:38:28 AM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s
rxmcst/s   %ifutil
03:38:29 AM      eth0   7770.00   4444.00  10720.12   5574.74      0.00      0.00
0.00      0.00
03:38:29 AM        lo     24.00     24.00     19.63     19.63      0.00      0.00
0.00      0.00
03:38:29 AM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s
rxmcst/s   %ifutil
03:38:30 AM      eth0   5579.00   2175.00   7829.20   2626.93      0.00      0.00
0.00      0.00
03:38:30 AM        lo     33.00     33.00      1.79      1.79      0.00      0.00
0.00      0.00
[...]
```
The sar(1) tool has many modes for different groups of metrics. Here I’m using it to look at network device metrics. Check interface throughput rxkB/s and txkB/s to see if any limit may have been reached.

* sar -n TCP,ETCP 1
```
Linux 4.13.0-19-generic (...)      08/04/2019     _x86_64_       (16 CPU)

03:41:01 AM  active/s passive/s    iseg/s    oseg/s
03:41:02 AM      1.00      1.00    348.00   1626.00

03:41:01 AM  atmptf/s  estres/s retrans/s isegerr/s   orsts/s
03:41:02 AM      0.00      0.00      1.00      0.00      0.00

03:41:02 AM  active/s passive/s    iseg/s    oseg/s
03:41:03 AM      0.00      0.00    521.00   2660.00

03:41:02 AM  atmptf/s  estres/s retrans/s isegerr/s   orsts/s
03:41:03 AM      0.00      0.00      0.00      0.00      0.00
[...]
```
Now we’re using sar(1) to look at TCP metrics and TCP errors. Columns to check:

active/s: Number of locally initiated TCP connections per second (e.g., via connect())

passive/s: Number of remotely initiated TCP connections per second (e.g., via accept())

retrans/s: Number of TCP retransmits per second

Active and passive connection counts are useful for workload characterization. Retransmits are a sign of a network or remote host issue.

* top
```
03:44:14 up 17 days,  4:46,  1 user,  load average: 2.32, 2.20, 2.21
Tasks: 474 total,   1 running, 473 sleeping,   0 stopped,   0 zombie
%Cpu(s): 29.7 us,  0.4 sy,  0.0 ni, 69.7 id,  0.1 wa,  0.0 hi,  0.0 si,  0.0 st
KiB Mem : 12582137+total,  3159704 free, 40109716 used, 82551960 buff/cache
KiB Swap:        0 total,        0 free,        0 used. 83151728 avail Mem

   PID USER      PR  NI    VIRT    RES    SHR S  %CPU %MEM     TIME+ COMMAND
 12569 www       20   0  2.495t 0.051t 0.018t S 484.7 43.3  13276:02 java
 12178 www       20   0 12.214g 3.107g  16540 S   4.9  2.6    553:41 java
125312 root      20   0       0      0      0 S   1.0  0.0   0:13.20 kworker/u256:0

128697 root      20   0       0      0      0 S   0.3  0.0   0:02.10 kworker/10:2
[...]
```
At this point you’ll have already seen many of these metrics with prior tools, but it can be useful to double-check by finishing with the top(1) utility and browsing the system and process summaries.

With luck, this 60-second analysis will have helped you unearth a clue or two about the performance of your system. You can use these clues to jump to some related BPF tools for further analysis.


sudo apt install  bpfcc-tools
 perf-tools-unstable

execsnoop

opensnoop

ext4slower (or btrfs*, xfs*, zfs*)

biolatency

biosnoop

cachestat

tcpconnect

tcpaccept

tcpretrans

runqlat

profile
```
# execsnoop
PCOMM            PID    RET ARGS
supervise        9660     0 ./run
supervise        9661     0 ./run
mkdir            9662     0 /bin/mkdir -p ./main
run              9663     0 ./run
[...]
```
execsnoop(8) shows new process execution by printing one line of output for every execve(2) syscall. Check for short-lived processes, as these can consume CPU resources, but may not show up in most monitoring tools that periodically take snapshots of which processes are running. execsnoop(8) is covered in detail in Chapter 6.


# opensnoop
PID    COMM               FD ERR PATH
1565   redis-server        5   0 /proc/1565/stat
1603   snmpd               9   0 /proc/net/dev
1603   snmpd              11   0 /proc/net/if_inet6
1603   snmpd              -1   2 /sys/class/net/eth0/device/vendor
1603   snmpd              11   0 /proc/sys/net/ipv4/neigh/eth0/retrans_time_ms
1603   snmpd              11   0 /proc/sys/net/ipv6/neigh/eth0/retrans_time_ms
1603   snmpd              11   0 /proc/sys/net/ipv6/conf/eth0/forwarding
[...]

opensnoop(8) prints one line of output for each open(2) syscall (and its variants), including details of the path that was opened and whether it was successful (the “ERR” error column). Opened files can tell you a lot about how applications work: identifying their data files, config files, and log files. Sometimes applications can misbehave and perform poorly when they are constantly attempting to read files that do not exist. opensnoop(8) is covered in more detail in Chapter 8.

> broken call, works with the ones from bcc

# ext4slower
Tracing ext4 operations slower than 10 ms
TIME     COMM           PID    T BYTES   OFF_KB   LAT(ms) FILENAME
06:35:01 cron           16464  R 1249    0          16.05 common-auth
06:35:01 cron           16463  R 1249    0          16.04 common-auth
06:35:01 cron           16465  R 1249    0          16.03 common-auth
06:35:01 cron           16465  R 4096    0          10.62 login.defs
06:35:01 cron           16464  R 4096    0          10.61 login.defs
[...]

ext4slower(8) traces common operations from the ext4 file system (reads, writes, opens, and syncs) and prints those that exceed a time threshold. This can identify or exonerate one type of performance issue: an application waiting on slow individual disk I/O via the file system. There are variants of ext4slower(8) for other file systems, including btrfsslower(8), xfsslower(8), and zfsslower(8). See Chapter 8 for more details.

# biolatency -m
Tracing block device I/O... Hit Ctrl-C to end.
^C
     msecs               : count     distribution
         0 -> 1          : 16335    |****************************************|
         2 -> 3          : 2272     |*****                                   |
         4 -> 7          : 3603     |********                                |
         8 -> 15         : 4328     |**********                              |
        16 -> 31         : 3379     |********                                |
        32 -> 63         : 5815     |**************                          |
        64 -> 127        : 0        |                                        |
       128 -> 255        : 0        |                                        |
       256 -> 511        : 0        |                                        |
       512 -> 1023       : 1        |                                        |

biolatency(8) traces disk I/O latency (that is, the time from device issue to completion) and shows this as a histogram. This better explains disk I/O performance than the averages shown by iostat(1). Multiple modes can be examined. Modes are values that are more frequent than others in a distribution, and this example shows a multi-modal distribution with one mode between 0 and 1 milliseconds, and another mode centered around the 8- to 15-millisecond range.4 Outliers are also visible: this screenshot shows a single outlier in the 512- to 1023-millisecond range. biolatency(8) is covered in more detail in Chapter 9.

4 It looks a little skewed because of the log-2 distribution: buckets span progressively larger ranges. If I needed to understand this better, I would either modify biolatency(8) to use a higher-resolution linear histogram instead, or use the biosnoop(8) tool to log disk I/O and then import that log into spreadsheet software for custom histograms.

# biosnoop
TIME(s)        COMM           PID    DISK    T  SECTOR    BYTES   LAT(ms)
0.000004001    supervise      1950   xvda1   W  13092560  4096       0.74
0.000178002    supervise      1950   xvda1   W  13092432  4096       0.61
0.001469001    supervise      1956   xvda1   W  13092440  4096       1.24
0.001588002    supervise      1956   xvda1   W  13115128  4096       1.09
1.022346001    supervise      1950   xvda1   W  13115272  4096       0.98
[...]

biosnoop(8) prints a line of output for each disk I/O, with details including latency. This allows you to examine disk I/O in more detail, and look for time-ordered patterns (e.g., reads queueing behind writes). biosnoop(8) is covered in more detail in Chapter 9.


# cachestat
    HITS   MISSES  DIRTIES HITRATIO   BUFFERS_MB  CACHED_MB
   53401     2755    20953   95.09%           14      90223
   49599     4098    21460   92.37%           14      90230
   16601     2689    61329   86.06%           14      90381
   15197     2477    58028   85.99%           14      90522
[...]

cachestat(8) prints a one-line summary every second (or every custom interval) showing statistics from the file system cache. Use this to identify a low cache hit ratio and a high rate of misses. This may give you a lead for performance tuning. cachestat(8) is covered in more detail in Chapter 8.

# tcpconnect
PID    COMM         IP SADDR            DADDR            DPORT
1479   telnet       4  127.0.0.1        127.0.0.1        23
1469   curl         4  10.201.219.236   54.245.105.25    80
1469   curl         4  10.201.219.236   54.67.101.145    80
1991   telnet       6  ::1              ::1              23
2015   ssh          6  fe80::2000:bff:fe82:3ac fe80::2000:bff:fe82:3ac 22
[...]

tcpconnect(8) prints one line of output for every active TCP connection (e.g., via connect()), with details including source and destination addresses. Look for unexpected connections that may point to inefficiencies in application configuration or an intruder. tcpconnect(8) is covered in more detail in Chapter 10.

> not working 

# tcpaccept
PID    COMM     IP RADDR            LADDR            LPORT
907    sshd     4  192.168.56.1     192.168.56.102   22
907    sshd     4  127.0.0.1        127.0.0.1        22
5389   perl     6  1234:ab12:2040:5020:2299:0:5:0 1234:ab12:2040:5020:2299:0:5:0 7001
[...]

tcpaccept(8) is a companion tool to tcpconnect(8). It prints one line of output for every passive TCP connection (e.g., via accept()), with details including source and destination addresses. tcpaccept(8) is covered in more detail in Chapter 10.

> not working 

# tcpretrans
TIME     PID    IP LADDR:LPORT          T> RADDR:RPORT          STATE
01:55:05 0      4  10.153.223.157:22    R> 69.53.245.40:34619   ESTABLISHED
01:55:05 0      4  10.153.223.157:22    R> 69.53.245.40:34619   ESTABLISHED
01:55:17 0      4  10.153.223.157:22    R> 69.53.245.40:22957   ESTABLISHED
[...]

tcpretrans(8) prints one line of output for every TCP retransmit packet, with details including source and destination addresses, and the kernel state of the TCP connection. TCP retransmissions cause latency and throughput issues. For retransmissions where the TCP session state is ESTABLISHED, look for problems with external networks. For the SYN_SENT state, this may point to target kernel CPU saturation and kernel packet drops as well. tcpretrans(8) is covered in more detail in Chapter 10.

> failed, and works with the ones on github...

# runqlat
Tracing run queue latency... Hit Ctrl-C to end.
^C
     usecs               : count     distribution
         0 -> 1          : 233      |***********                             |
         2 -> 3          : 742      |************************************    |
         4 -> 7          : 203      |**********                              |
         8 -> 15         : 173      |********                                |
        16 -> 31         : 24       |*                                       |
        32 -> 63         : 0        |                                        |
        64 -> 127        : 30       |*                                       |
       128 -> 255        : 6        |                                        |
       256 -> 511        : 3        |                                        |
       512 -> 1023       : 5        |                                        |
      1024 -> 2047       : 27       |*                                       |
      2048 -> 4095       : 30       |*                                       |
      4096 -> 8191       : 20       |                                        |
      8192 -> 16383      : 29       |*                                       |
     16384 -> 32767      : 809      |****************************************|
     32768 -> 65535      : 64       |***                                     |

runqlat(8) times how long threads were waiting for their turn on CPU and prints this time as a histogram. Longer-than-expected waits for CPU access can be identified using this tool, which threads can suffer due to CPU saturation, misconfigurations, or scheduler issues. runqlat(8) is covered in more detail in Chapter 6.

# profile
Sampling at 49 Hertz of all threads by user + kernel stack... Hit Ctrl-C to end.
^C
[...]

    copy_user_enhanced_fast_string
    copy_user_enhanced_fast_string
    _copy_from_iter_full
    tcp_sendmsg_locked
    tcp_sendmsg
    inet_sendmsg
    sock_sendmsg
    sock_write_iter
    new_sync_write
    __vfs_write
    vfs_write
    SyS_write
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    [unknown]
    [unknown]
    -                iperf (24092)
        58

profile(8) is a CPU profiler, a tool you can use to understand which code paths are consuming CPU resources. It takes samples of stack traces at timed intervals and prints a summary of unique stack traces and a count of their occurrence. This output has been truncated and only shows one stack trace, with an occurrence count of 58 times. profile(8) is covered in more detail in Chapter 6.

# 3.5 SUMMARY
Performance analysis is about improving end-user performance and reducing operating costs. There are many tools and metrics to help you analyze performance; in fact, there are so many that choosing the right ones to use in a given situation can be overwhelming. Performance methodologies can guide you through these choices, showing you where to start, steps for analysis, and where to end.

This chapter summarizes performance analysis methodologies: workload characterization, latency analysis, the USE method, and checklists. A Linux performance analysis in 60 seconds checklist was then included and explained, which can be your starting point for any performance issue. It may help you solve issues outright, or at least yield clues about where the performance issue is and direct further analysis with BPF tools. In addition, this chapter includes a BPF checklist of BCC tools, which are explained in more detail in later chapters.