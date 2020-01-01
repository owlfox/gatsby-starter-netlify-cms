Chapter 7. Memory
Linux is a virtual memory–based system where each process has its own virtual address space, and mappings to physical memory are made on demand. Its design allows for over-subscription of physical memory, which Linux manages with a page out daemon and physical swap devices and (as a last resort) the out-of-memory (OOM) killer. Linux uses spare memory as a file system cache, a topic covered in Chapter 8.

This chapter shows how BPF can expose application memory usage in new ways and help you examine how the kernel is responding to memory pressure. As CPU scalability has grown faster than memory speeds, memory I/O has become the new bottleneck. Understanding memory usage can lead to finding many performance wins.

Learning Objectives:

Understand memory allocation and paging behavior

Learn a strategy for successful analysis of memory behavior using tracers

Use traditional tools to understand memory capacity usage

Use BPF tools to identify code paths causing heap and RSS growth

Characterize page faults by filename and stack trace

Analyze the behavior of the VM scanner

Determine the performance impact of memory reclaim

Identify which processes are waiting for swap-ins

Use bpftrace one-liners to explore memory usage in custom ways

This chapter begins with some necessary background for memory analysis, with a focus on application usage, summarizing virtual and physical allocation, and paging. Questions that BPF can answer are explored, as well as an overall strategy to follow. Traditional memory analysis tools are summarized first, and then BPF tools are covered, including a list of BPF one-liners. This chapter ends with optional exercises.

Chapter 14 provides additional tools for kernel memory analysis.

7.1 BACKGROUND
This section covers memory fundamentals, BPF capabilities, and a suggested strategy for memory analysis.

7.1.1 Memory Fundamentals
Memory Allocators
Figure 7-1 shows commonly used memory allocation systems for user- and kernel-level software. For processes using libc for memory allocation, memory is stored on a dynamic segment of the process’s virtual address space called the heap. libc provides functions for memory allocation, including malloc() and free(). When memory is freed, libc tracks its location and can use that location information to fulfill a subsequent malloc(). libc needs to extend the size of the heap only when there is no available memory. There is usually no reason for libc to shrink the size of the heap as this is all virtual memory, not real physical memory.

The kernel and processor are responsible for mapping virtual memory to physical memory. For efficiency, memory mappings are created in groups of memory called pages, where the size of each page is a processor detail; four Kbytes is common, although most processors also support larger sizes—what Linux terms huge pages. The kernel can service physical memory page requests from its own free lists, which it maintains for each DRAM group and CPU for efficiency. The kernel’s own software also consumes memory from these free lists as well, usually via a kernel allocator such as the slab allocator.


Figure 7-1 Memory allocators

Other user allocation libraries include tcmalloc and jemalloc, and runtimes such as the JVM often provide their own allocator along with garbage collection. Other allocators may also map private segments for allocation outside of the heap.


Figure 7-2 Memory page life cycle

Memory Pages and Swapping
The life cycle of a typical user memory page is shown in Figure 7-2, with the following steps enumerated:

The application begins with an allocation request for memory (e.g., libc malloc()).

The allocation library can either service the memory request from its own free lists, or it may need to expand virtual memory to accommodate. Depending on the allocation library, it will either:

Extend the size of the heap by calling a brk() syscall and using the heap memory for the allocation.

Create a new memory segment via the mmap() syscall.

Sometime later, the application tries to use the allocated memory range through store and load instructions, which involves calling in to the processor memory management unit (MMU) for virtual-to-physical address translation. At this point, the lie of virtual memory is revealed: There is no mapping for this address! This causes an MMU error called a page fault.

The page fault is handled by the kernel, which establishes a mapping from its physical memory free lists to virtual memory and then informs the MMU of this mapping for later lookups. The process is now consuming an extra page of physical memory. The amount of physical memory in use by the process is called its resident set size (RSS).

When there is too much memory demand on the system, the kernel page-out daemon (kswapd) may look for memory pages to free. It will free one of three types of memory (though only (c) is pictured in Figure 7-2, as it is showing a user memory page life cycle):

File system pages that were read from disk and not modified (termed "backed by disk"): These can be freed immediately and simply reread back when needed. These pages are application-executable text, data, and file system metadata.

File system pages that have been modified: These are “dirty” and must be written to disk before they can be freed.

Pages of application memory: These are called anonymous memory because they have no file origin. If swap devices are in use, these can be freed by first being stored on a swap device. This writing of pages to a swap device is termed swapping (on Linux).

Memory allocation requests are typically frequent activities: User-level allocations can occur millions of times per second for a busy application. Load and store instructions and MMU lookups are even more frequent; they can occur billions of times per second. In Figure 7-2, these arrows are drawn in bold. Other activities are relatively infrequent: brk() and mmap() calls, page faults, and page-outs (lighter arrows).

Page-Out Daemon
The page-out daemon (kswapd) is activated periodically to scan LRU lists of inactive and active pages in search of memory to free. It is woken up when free memory crosses a low threshold and goes back to sleep when it crosses a high threshold, as shown in Figure 7-3.


Figure 7-3 kswapd wakeups and modes

kswapd coordinates background page-outs; apart from CPU and disk I/O contention, these should not directly harm application performance. If kswapd cannot free memory quickly enough, a tunable minimum pages threshold is crossed, and direct reclaim is used; this is a foreground mode of freeing memory to satisfy allocations. In this mode, allocations block (stall) and synchronously wait for pages to be freed [Gorman 04] [81].

Direct reclaim can call kernel module shrinker functions: These free up memory that may have been kept in caches, including the kernel slab caches.

Swap Devices
Swap devices provide a degraded mode of operation for a system running out of memory: Processes can continue to allocate, but less frequently used pages are now moved to and from their swap devices, which usually causes applications to run much more slowly. Some production systems run without swap; the rationale is that the degraded mode of operation is never acceptable for those critical systems, which may have numerous redundant (and healthy!) servers that would be much better to use than one that has begun swapping. (This is usually the case for Netflix cloud instances, for example.) If a swap-less system runs out of memory, the kernel out-of-memory killer sacrifices a process. Applications are configured to never exceed the memory limits of the system, to avoid this.

OOM Killer
The Linux out-of-memory killer is a last resort to free up memory: It will find victim processes using a heuristic, and sacrifice them by killing them. The heuristic looks for the largest victim that will free many pages, and that isn’t a critical task such as kernel threads or init (PID 1). Linux provides ways to tune the behavior of the OOM killer system-wide and per-process.

Page Compaction
Over time, the freed pages become fragmented, making it difficult for the kernel to allocate a large contiguous chunk, if needed. The kernel uses a compaction routine to move pages, freeing up contiguous regions [81].

File System Caching and Buffering
Linux borrows free memory for file system caching and returns it to the free status when there is demand. A consequence of such borrowing is that the free memory reported by the system rushes toward zero after Linux boots, which may cause a user to worry that the system is running out of memory when actually it’s just warming up its file system cache. In addition, the file system uses memory for write-back buffering.

Linux can be tuned to prefer freeing from the file system cache or freeing memory via swapping (vm.swappiness).

Caching and buffering are discussed further in Chapter 8.

Further Reading
This is a brief summary to arm you with essential knowledge before using the tools. Additional topics, including kernel page allocation and NUMA, are covered in Chapter 14. Memory allocation and paging are covered in much more depth in Chapter 7 of Systems Performance [Gregg 13b].

7.1.2 BPF Capabilities
Traditional performance tools provide some insight for memory internals. For example, they can show breakdowns of virtual and physical memory usage and the rates of page operations. These traditional tools are summarized in the next section.

BPF tracing tools can provide additional insight for memory activity, answering:

Why does the process physical memory (RSS) keep growing?

What code paths are causing page faults? For which files?

What processes are blocked waiting on swap-ins?

What memory mappings are being created system-wide?

What is the system state at the time of an OOM kill?

What application code paths are allocating memory?

What types of objects are allocated by applications?

Are there memory allocations that are not freed after a while? (They could indicate potential leaks.)

These can be answered with BPF by instrumenting software events or tracepoints for faults and syscalls; kprobes for kernel memory allocation functions; uprobes for library, runtime, and application allocators; USDT probes for libc allocator events; and PMCs for overflow sampling of memory accesses. These event sources can also be mixed in one BPF program to share context between different systems.

Memory events including allocations, memory mappings, faults, and swapping, can all be instrumented using BPF. Stack traces can be fetched to show the reasons for many of these events.

Event Sources
Table 7-1 lists the event sources for instrumenting memory.

Table 7-1 Event Sources for Instrumenting Memory

Event Type

Event Source

User memory allocations

uprobes on allocator functions and libc USDT probes

Kernel memory allocations

kprobes on allocator functions and kmem tracepoints

Heap expansions

brk syscall tracepoints

Shared memory functions

syscall tracepoints

Page faults

kprobes, software events, and exception tracepoints

Page migrations

migration tracepoints

Page compaction

compaction tracepoints

VM scanner

vmscan tracepoints

Memory access cycles

PMCs

Here are the USDT probes available in libc:

Click here to view code image


# bpftrace -l usdt:/lib/x86_64-linux-gnu/libc-2.27.so
[...]
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_arena_max
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_arena_test
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_tunable_tcache_max_bytes
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_tunable_tcache_count
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_tunable_tcache_unsorted_limit
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_trim_threshold
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_top_pad
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_mmap_threshold
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_mmap_max
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_perturb
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_heap_new
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_sbrk_less
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_arena_reuse
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_arena_reuse_wait
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_arena_new
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_arena_reuse_free_list
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_arena_retry
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_heap_free
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_heap_less
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_heap_more
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_sbrk_more
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_free_dyn_thresholds
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_malloc_retry
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_memalign_retry
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_realloc_retry
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_calloc_retry
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt
usdt:/lib/x86_64-linux-gnu/libc-2.27.so:libc:memory_mallopt_mxfast

These probes provide insight into the internal operation of the libc allocator.

Overhead
As mentioned earlier, memory allocation events can occur millions of times per second. Although BPF programs are optimized to be fast, calling them millions of times per second can add up to significant overhead, slowing the target software by more than 10%, and in some cases by 10 times (10x), depending on the rate of events traced and the BPF program used.

To work around this overhead, Figure 7-2 shows which paths are frequent by using bold arrows and which are infrequent by using lighter arrows. Many questions about memory usage can be answered, or approximated, by tracing the infrequent events: page faults, page outs, brk() calls, and mmap() calls. The overhead of tracing these events can be negligible.

One reason to trace the malloc() calls is to show the code paths that led to malloc(). These code paths can be revealed using a different technique: timed sampling of CPU stacks, as covered in Chapter 6. Searching for “malloc” in a CPU flame graph is a coarse but cheap way to identify the code paths calling this function frequently, without needing to trace the function directly.

The performance of uprobes may be greatly improved in the future (10x to 100x) through dynamic libraries involving user-to-user-space jumps rather than kernel traps (see Section 2.8.4 in Chapter 2).

7.1.3 Strategy
If you are new to memory performance analysis, here is a suggested overall strategy to follow:

Check system messages to see if the OOM killer has recently killed processes (e.g., using dmesg(1)).

Check whether the system has swap devices and the amount of swap in use; also check whether those devices have active I/O (e.g., using swap(1), iostat(1), and vmstat(1)).

Check the amount of free memory on the system and system-wide usage by caches (e.g., free(1)).

Check per-process memory usage (e.g., using top(1) and ps(1)).

Check the page fault rate and examine stack traces on page faults, which can explain RSS growth.

Check the files that were backing page faults.

Trace brk() and mmap() calls for a different view of memory usage.

Browse and execute the BPF tools listed in the BPF tools section of this chapter.

Measure hardware cache misses and memory accesses using PMCs (especially with PEBS enabled) to determine functions and instructions causing memory I/O (e.g., using perf(1)).

The following sections explain these tools in more detail.

7.2 TRADITIONAL TOOLS
Traditional performance tools provide many capacity-based memory usage statistics, including how much virtual and physical memory is in use by each process and system-wide, with some breakdowns such as by process segment or slab. Analyzing memory usage beyond basics such as the page fault rate required built-in instrumentation for each allocation by the allocation library, runtime, or application; or a virtual machine analyzer like Valgrind could be used; this latter approach can cause the target application to run over 10 times slower while instrumented. BPF tools are more efficient and cost smaller overheads.

Even where they are not sufficient on their own to solve issues, traditional tools can provide clues to direct your use of BPF tools. The traditional tools listed in Table 7-2 have been categorized here based on their source and measurement type.

Table 7-2 Traditional Tools

Tool

Type

Description

dmesg

Kernel log

OOM killer event details

swapon

Kernel statistics

Swap device usage

free

Kernel statistics

System-wide memory usage

ps

Kernel statistics

Process statistics, including memory usage

pmap

Kernel statistics

Process memory usage by segment

vmstat

Kernel statistics

Various statistics, including memory

sar

Kernel statistics

Can show page fault and page scanner rates

perf

Software events, hardware statistics, hardware sampling

Memory-related PMC statistics and event sampling

The following sections summarize the key functionality of these tools. Refer to their man pages and other resources, including Systems Performance [Gregg 13b], for more usage and explanations. Chapter 14 includes slabtop(1) for kernel slab allocations.

7.2.1 Kernel Log
The kernel out-of-memory killer writes details to the system log, viewable using dmesg(1), for each time it needs to kill a process. For example:

Click here to view code image


# dmesg
[2156747.865271] run invoked oom-killer: gfp_mask=0x24201ca, order=0, oom_score_adj=0
[...]
[2156747.865330] Mem-Info:
[2156747.865333] active_anon:3773117 inactive_anon:20590 isolated_anon:0
[2156747.865333]  active_file:3 inactive_file:0 isolated_file:0
[2156747.865333]  unevictable:0 dirty:0 writeback:0 unstable:0
[2156747.865333]  slab_reclaimable:3980 slab_unreclaimable:5811
[2156747.865333]  mapped:36 shmem:20596 pagetables:10620 bounce:0
[2156747.865333]  free:18748 free_pcp:455 free_cma:0
[...]
[2156747.865385] [ pid ]   uid  tgid total_vm      rss nr_ptes nr_pmds swapents
oom_score_adj name
[2156747.865390] [  510]     0   510     4870       67      15       3        0
0 upstart-udev-br
[2156747.865392] [  524]     0   524    12944      237      28       3        0
-1000 systemd-udevd
[...]
[2156747.865574] Out of memory: Kill process 23409 (perl) score 329 or sacrifice child
[2156747.865583] Killed process 23409 (perl) total-vm:5370580kB, anon-rss:5224980kB,
file-rss:4kB

The output includes a summary of system-wide memory usage, the process table, and the target process that was sacrificed.

You should always check dmesg(1) before getting into deeper memory analysis.

7.2.2 Kernel Statistics
Kernel statistics tools use statistical sources in the kernel, often exposed via the /proc interface (e.g., /proc/meminfo, /proc/swaps). An advantage of these tools is that the metrics are usually always enabled by the kernel, so there is little additional overhead involved in using them. They can also often be read by non-root users.

swapon
swapon(1) can show whether swap devices have been configured and how much of their volume is in use. For example:

Click here to view code image


$ swapon
NAME      TYPE      SIZE USED PRIO
/dev/dm-2 partition 980M   0B   -2

This output shows a system with one swap partition of 980 Mbytes, which is not in use at all. Many systems nowadays do not have swap configured, and if this is the case, swapon(1) does not print any output.

If a swap device has active I/O, it can be seen in the “si” and “so” columns in vmstat(1), and as device I/O in iostat(1).

free
The free(1) tool summarizes memory usage and shows available free memory system-wide. This example uses -m for Mbytes:

Click here to view code image


$ free -m
              total        used        free      shared  buff/cache   available
Mem:         189282      183022        1103           4        5156        4716
Swap:             0           0           0

The output from free(1) has improved in recent years to be less confusing; it now includes an “available” column that shows how much memory is available for use, including the file system cache. This is less confusing than the “free” column, which only shows memory that is completely unused. If you think the system is running low on memory because “free” is low, you need to consider “available” instead.

The file system cached pages are seen in the “buff/cache” column, which sums two types: I/O buffers and file system cached pages. You can view these pages in separate columns by using the -w option (wide).

This particular example is from a production system with 184 Gbytes of total main memory, of which about 4 Gbytes is currently available. For more breakdowns of system-wide memory, cat /proc/meminfo.

ps
The ps(1) process status command can show memory usage by process:

Click here to view code image


$ ps aux
USER   PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
[...]
root  2499  0.0  0.0  30028  2720 ?        Ss   Jan25   0:00 /usr/sbin/cron -f
root  2703  0.0  0.0      0     0 ?        I    04:13   0:00 [kworker/41:0]
pcp   2951  0.0  0.0 116716  3572 ?        S    Jan25   0:00 /usr/lib/pcp/bin/pmwe...
root  2992  0.0  0.0      0     0 ?        I    Jan25   0:00 [kworker/17:2]
root  3741  0.0  0.0      0     0 ?        I    Jan25   0:05 [kworker/0:3]
www   3785 1970 95.7 213734052 185542800 ? Sl   Jan25 15123:15 /apps/java/bin/java...
[...]

This output has columns for:

%MEM: The percentage of the system’s physical memory in use by this process

VSZ: Virtual memory size

RSS: Resident set size: the total physical memory in use by this process

This output shows that the java process is consuming 95.7% of the physical memory on the system. The ps(1) command can print custom columns to focus only on memory statistics (e.g., ps -eo pid,pmem,vsz,rss). These statistics and more can be found in the /proc files: /proc/PID/status.

pmap
The pmap(1) command can show process memory usage by address space segment. For example:

Click here to view code image


$ pmap -x 3785
3785:   /apps/java/bin/java -Dnop -XX:+UseG1GC -...
XX:+ParallelRefProcEnabled -XX:+ExplicitGCIn
Address           Kbytes     RSS   Dirty Mode  Mapping
0000000000400000       4       0       0 r-x-- java
0000000000400000       0       0       0 r-x-- java
0000000000600000       4       4       4 rw--- java
0000000000600000       0       0       0 rw--- java
00000000006c2000    5700    5572    5572 rw---   [ anon ]
00000000006c2000       0       0       0 rw---   [ anon ]
[...]
00007f2ce5e61000       0       0       0 ----- libjvm.so
00007f2ce6061000     832     832     832 rw--- libjvm.so
00007f2ce6061000       0       0       0 rw--- libjvm.so
[...]
ffffffffff600000       4       0       0 r-x--   [ anon ]
ffffffffff600000       0       0       0 r-x--   [ anon ]
---------------- ------- ------- -------
total kB         213928940 185743916 185732800

This view can identify large memory consumers by libraries or mapped files. This extended (-x) output includes a column for “dirty” pages: pages that have changed in memory and are not yet saved on disk.

vmstat
The vmstat(1) command shows various system-wide statistics over time, including statistics for memory, CPUs, and storage I/O. For example, printing a summary line every one second:

Click here to view code image


$ vmstat 1
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
12  0      0 1075868  13232 5288396    0    0    14    26   16   19 38  2 59  0  0
14  0      0 1075000  13232 5288932    0    0     0     0 28751 77964 22  1 77  0  0
 9  0      0 1074452  13232 5289440    0    0     0     0 28511 76371 18  1 81  0  0
15  0      0 1073824  13232 5289828    0    0     0     0 32411 86088 26  1 73  0  0

The “free”, “buff”, and “cache” columns show memory in Kbytes that is free, used by storage I/O buffers, and used for the file system cache. The “si” and “so” columns show memory swapped in and out from disk, if active.

The first line of output is the “summary since boot,” where most columns are an average since the system booted; however, the memory columns show the current state. The second and subsequent lines are the one-second summaries.

sar
The sar(1) command is a multi-tool that prints metrics for different targets. The -B option shows page statistics:

Click here to view code image


# sar -B 1
Linux 4.15.0-1031-aws (...)      01/26/2019          _x86_64_   (48 CPU)

06:10:38 PM  pgpgin/s pgpgout/s   fault/s  majflt/s  pgfree/s pgscank/s pgscand/s
pgsteal/s    %vmeff
06:10:39 PM      0.00      0.00    286.00      0.00  16911.00      0.00      0.00
0.00      0.00
06:10:40 PM      0.00      0.00     90.00      0.00  19178.00      0.00      0.00
0.00      0.00
06:10:41 PM      0.00      0.00    187.00      0.00  18949.00      0.00      0.00
0.00      0.00
06:10:42 PM      0.00      0.00    110.00      0.00  24266.00      0.00      0.00
0.00      0.00
[...]

This output is from a busy production server. The output is very wide, so the columns have wrapped and are a little hard to read here. The page fault rate (“fault/s”) is low—less than 300 per second. There also isn’t any page scanning (the “pgscan” columns), indicating that the system is likely not running at memory saturation.

Here is output from a server doing a software build:

Click here to view code image


# sar -B 1
Linux 4.18.0-rc6-virtual (...)  01/26/2019           _x86_64_   (36 CPU)

06:16:08 PM  pgpgin/s pgpgout/s   fault/s  majflt/s  pgfree/s pgscank/s pgscand/s
pgsteal/s    %vmeff
06:16:09 PM   1968.00    302.00 1454167.00      0.00 1372222.00      0.00      0.00
0.00      0.00
06:16:10 PM   1680.00    171.00 1374786.00      0.00 1203463.00      0.00      0.00
0.00      0.00
06:16:11 PM   1100.00    581.00 1453754.00      0.00 1457286.00      0.00      0.00
0.00      0.00
06:16:12 PM   1376.00    227.00 1527580.00      0.00 1364191.00      0.00      0.00
0.00      0.00
06:16:13 PM    880.00     68.00 1456732.00      0.00 1315536.00      0.00      0.00
0.00      0.00
[...]

Now the page fault rate is huge—over one million faults per second. This is because the software build involves many short-lived processes, and each new process is faulting in its address space on first execution.

7.2.3 Hardware Statistics and Sampling
There are many PMCs for memory I/O events. To be clear, this is I/O from the CPU units on the processor to the banks of main memory, via the CPU caches. PMCs, introduced in Chapter 2, can be used in two modes: counting and sampling. Counting provides statistical summaries, and costs virtually zero overhead to use. Sampling records some of the events to a file for later analysis.

This example uses perf(1) in counting mode to measure last-level cache (LLC) loads and misses, system-wide (-a), with interval output every 1 second (-I 1000):

Click here to view code image


# perf stat -e LLC-loads,LLC-load-misses -a -I 1000
#           time         counts unit events
     1.000705801      8,402,738      LLC-loads
     1.000705801      3,610,704      LLC-load-misses  #   42.97% of all LL-cache hits
     2.001219292      8,265,334      LLC-loads
     2.001219292      3,526,956      LLC-load-misses  #   42.32% of all LL-cache hits
     3.001763602      9,586,619      LLC-loads
     3.001763602      3,842,810      LLC-load-misses  #   43.91% of all LL-cache hits
[...]

For convenience, perf(1) has recognized how these PMCs are related and printed a percentage miss ratio. LLC misses are one measure of I/O to main memory, since once a memory load or store misses the LLC, it becomes a main memory access.

Now perf(1) is used in sampling mode to record details from every one in one hundred thousand L1 data cache misses:

Click here to view code image


# perf record -e L1-dcache-load-misses -c 100000 -a
^C[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 3.075 MB perf.data (612 samples) ]
# perf report -n --stdio
# Overhead  Samples  Command  Shared Object        Symbol
# ........  .......  .......  ...................  ..................................
#
    30.56%      187  cksum    [kernel.kallsyms]    [k] copy_user_enhanced_fast_string
     8.33%       51  cksum    cksum                [.] 0x0000000000001cc9
     2.78%       17  cksum    cksum                [.] 0x0000000000001cb4
     2.45%       15  cksum    [kernel.kallsyms]    [k] generic_file_read_iter
     2.12%       13  cksum    cksum                [.] 0x0000000000001cbe
[...]

Such a large sampling threshold (-c 100000) was used because L1 accesses are very frequent, and a lower threshold might collect so many samples that it would perturb the performance of running software. If you are unsure of the rate of a PMC, use counting mode first (perf stat) to find it, and from that you can calculate an appropriate threshold.

The output of perf report shows the symbols for the L1 dcache misses. It is recommended to use PEBS with memory PMCs so that the sample instruction pointers are accurate. With perf, add :p, or :pp (better), or :ppp (best) to the end of the event name to enable PEBS; the more ps, the more accurate. (See the p modifier section of the perf-list(1) man page.)

7.3 BPF TOOLS
This section covers the BPF tools you can use for memory performance analysis and troubleshooting (see Figure 7-4).


Figure 7-4 BPF tools for memory analysis

These tools are either from the BCC and bpftrace repositories covered in Chapters 4 and 5, or were created for this book. Some tools appear in both BCC and bpftrace. Table 7-3 lists the origins of the tools covered in this section (BT is short for bpftrace.)

Table 7-3 Memory-Related Tools

Tool

Source

Target

Description

oomkill

BCC/BT

OOM

Shows extra info on OOM kill events

memleak

BCC

Sched

Shows possible memory leak code paths

mmapsnoop

Book

Syscalls

Traces mmap(2) calls system-wide

brkstack

Book

Syscalls

Shows brk() calls with user stack traces

shmsnoop

BCC

Syscalls

Traces shared memory calls with details

faults

Book

Faults

Shows page faults, by user stack trace

ffaults

Book

Faults

Shows page faults, by filename

vmscan

Book

VM

Measures VM scanner shrink and reclaim times

drsnoop

BCC

VM

Traces direct reclaim events, showing latency

swapin

Book

VM

Shows swap-ins by process

hfaults

Book

Faults

Shows huge page faults, by process

For tools from BCC and bpftrace, see their repositories for full and updated lists of tool options and capabilities. Some of the most important capabilities are summarized here.

Chapter 14 provides more BPF tools for kernel memory analysis: kmem(8), kpages(8), slabratetop(8), and numamove(8).

7.3.1 oomkill
oomkill(8)1 is a BCC and bpftrace tool for tracing out-of-memory killer events and printing details such as the load averages. Load averages provide some additional context for the system state at the time of the OOM, showing whether the system was getting busier or whether it was steady.

1 Origin: I created it on 9-Feb-2016, for BCC, to have a tool for launching extra debug info for the production OOM events I sometimes see. I wrote the bpftrace version on 7-Sep-2018.

The following example shows oomkill(8) from BCC, from a 48-CPU production instance:

Click here to view code image


# oomkill
Tracing OOM kills... Ctrl-C to stop.
08:51:34 Triggered by PID 18601 ("perl"), OOM kill of PID 1165 ("java"), 18006224
pages, loadavg: 10.66 7.17 5.06 2/755 18643
[...]

This output shows that PID 18601 (perl) needed memory, which triggered an OOM kill of PID 1165 (java). PID 1165 had reached 18006224 pages in size; these are usually 4 Kbytes per page, depending on the processor and process memory settings. The load averages show that the system was getting busier at the time of the OOM kill.

This tool works by tracing the oom_kill_process() function using kprobes and printing various details. In this case, the load averages are fetched by simply reading /proc/loadavg. This tool can be enhanced to print other details, as desired, when debugging OOM events. In addition, oom tracepoints that can reveal more details about how tasks are selected are not yet used by this tool.

The BCC version currently does not use command line arguments.

bpftrace
The following is the code for the bpftrace version of oomkill(8):

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/oom.h>

BEGIN
{
        printf("Tracing oom_kill_process()... Hit Ctrl-C to end.\n");
}

kprobe:oom_kill_process
{
        $oc = (struct oom_control *)arg1;
        time("%H:%M:%S ");
        printf("Triggered by PID %d (\"%s\"), ", pid, comm);
        printf("OOM kill of PID %d (\"%s\"), %d pages, loadavg: ",
            $oc->chosen->pid, $oc->chosen->comm, $oc->totalpages);
        cat("/proc/loadavg");
}

The program traces oom_kill_process() and casts the second argument as a struct oom_control, which contains details of the sacrificial process. It prints details of the current process (pid, comm) that led to the OOM event, and then the target details, and finally a system() call is used to print the load averages.

7.3.2 memleak
memleak(8)2 is a BCC tool that traces memory allocation and free events along with the allocation stack traces. Over time, it can show the long-term survivors—the allocations that have not been freed. This example shows memleak(8) running on a bash shell process3:

2 Origin: This was created by Sasha Goldshtein and published on 7-Feb-2016.

3 To ensure that frame pointer–based stack traces work and regular malloc routines are used, this bash was compiled with CFLAGS=-fno-omit-frame-pointer ./configure --without-gnu-malloc.

Click here to view code image


# memleak -p 3126
Attaching to pid 3228, Ctrl+C to quit.

[09:14:15] Top 10 stacks with outstanding allocations:
[...]
        960 bytes in 1 allocations from stack
                xrealloc+0x2a [bash]
                strvec_resize+0x2b [bash]
                maybe_make_export_env+0xa8 [bash]
                execute_simple_command+0x269 [bash]
                execute_command_internal+0x862 [bash]
                execute_connection+0x109 [bash]
                execute_command_internal+0xc18 [bash]
                execute_command+0x6b [bash]
                reader_loop+0x286 [bash]
                main+0x969 [bash]
                __libc_start_main+0xe7 [libc-2.27.so]
                [unknown]
        1473 bytes in 51 allocations from stack
                xmalloc+0x18 [bash]
                make_env_array_from_var_list+0xc8 [bash]
                make_var_export_array+0x3d [bash]
                maybe_make_export_env+0x12b [bash]
                execute_simple_command+0x269 [bash]
                execute_command_internal+0x862 [bash]
                execute_connection+0x109 [bash]
                execute_command_internal+0xc18 [bash]
                execute_command+0x6b [bash]
                reader_loop+0x286 [bash]
                main+0x969 [bash]
                __libc_start_main+0xe7 [libc-2.27.so]
                [unknown]

[...]

By default it prints output every five seconds, showing the allocation stacks and total bytes yet to be freed. The last stack shows that 1473 bytes were allocated via execute_command() and make_env_array_from_var_list().

memleak(8) alone cannot tell you whether these allocations are a genuine memory leak (that is, allocated memory with no references and which will never be freed), or memory growth, or just a long-term allocation. To differentiate between them, the code paths need to be studied and understood.

Without a -p PID provided, memleak(8) traces kernel allocations:

Click here to view code image


# memleak
Attaching to kernel allocators, Ctrl+C to quit.
[...]
[09:19:30] Top 10 stacks with outstanding allocations:
[...]
        15384576 bytes in 3756 allocations from stack
                __alloc_pages_nodemask+0x209 [kernel]
                alloc_pages_vma+0x88 [kernel]
                handle_pte_fault+0x3bf [kernel]
                __handle_mm_fault+0x478 [kernel]
                handle_mm_fault+0xb1 [kernel]
                __do_page_fault+0x250 [kernel]
                do_page_fault+0x2e [kernel]
                page_fault+0x45 [kernel]
[...]

For process targets, memleak(8) works by tracing the user-level allocation functions: malloc(), calloc(), free(), and so on. For the kernel, it uses the kmem tracepoints: kmem:kmalloc, kmem:kfree, and so on.

Command line usage:

Click here to view code image


memleak [options] [-p PID] [-c COMMAND] [interval [count]]

Options include:

-s RATE: Samples one in every RATE allocations to lower overhead

-o OLDER: Prunes allocations younger than OLDER, in milliseconds

Allocations, especially user-level allocations, can be extremely frequent—millions of times per second. This can slow the target application by as much as 10x or more, depending on how busy it is. For now, this means memleak(8) is more of a troubleshooting or debugging tool than an everyday production analysis tool. As mentioned earlier, this will be the case until the performance of uprobes is greatly improved.

7.3.3 mmapsnoop
mmapsnoop(8)4 traces the mmap(2) syscall system-wide and prints details of the requested mappings. This is useful for general debugging of memory mapping usage. Example output:

4 Origin: I first created this as mmap.d for DTrace: Dynamic Tracing in Oracle Solaris, Mac OS X and FreeBSD in 2010 [Gregg 11], and I created this BCC version for this book on 3-Feb-2019.

Click here to view code image


# mmapsnoop.py
PID    COMM           PROT MAP   OFFS(KB) SIZE(KB) FILE
6015   mmapsnoop.py   RW-  S---  0        260      [perf_event]
6015   mmapsnoop.py   RW-  S---  0        260      [perf_event]
[...]
6315   java           R-E  -P--  0        2222     libjava.so
6315   java           RW-  -PF-  168      8        libjava.so
6315   java           R--  -P--  0        43       ld.so.cache
6315   java           R-E  -P--  0        2081     libnss_compat-2.23.so
6315   java           RW-  -PF-  28       8        libnss_compat-2.23.so
6315   java           R-E  -P--  0        2146     libnsl-2.23.so
6315   java           RW-  -PF-  84       8        libnsl-2.23.so
6315   java           R--  -P--  0        43       ld.so.cache
6315   java           R-E  -P--  0        2093     libnss_nis-2.23.so
6315   java           RW-  -PF-  40       8        libnss_nis-2.23.so
6315   java           R-E  -P--  0        2117     libnss_files-2.23.so
6315   java           RW-  -PF-  40       8        libnss_files-2.23.so
6315   java           R--  S---  0        2        passwd
[...]

This output begins with mappings to the perf_event ring buffers that this BCC tool uses for fetching event output. Then java mappings can be seen for a new process startup, along with the protection and mapping flags.

Protection flags (PROT):

R: PROT_READ

W: PROT_WRITE

E: PROT_EXEC

Map flags (MAP):

S: MAP_SHARED

P: MAP_PRIVATE

F: MAP_FIXED

A: MAP_ANON

mmapsnoop(8) supports a -T option for printing a time column.

This tool works by instrumenting the syscalls:sys_enter_mmap tracepoint. The overhead of this tool should be negligible as the rate of new mappings should be relatively low.

Chapter 8 continues the analysis of memory-mapped files and includes the mmapfiles(8) and fmapfaults(8) tools.

7.3.4 brkstack
The usual memory store for application data is the heap, which grows via calls to the brk(2) syscall. It can be useful to trace brk(2) and show the user-level stack trace that led to this growth. There is also an sbrk(2) variant, but on Linux, sbrk(2) is implemented as a library call that calls brk(2).

brk(2) can be traced with the syscalls:syscall_enter_brk tracepoint, and stacks for this tracepoint can be shown using BCC’s trace(8) for per-event output and stackcount(8) for a frequency count, a bpftrace one-liner, and also perf(1). Examples using BCC tools:

Click here to view code image


# trace -U t:syscalls:sys_enter_brk
# stackcount -PU t:syscalls:sys_enter_brk

For example:

Click here to view code image


# stackcount -PU t:syscalls:sys_enter_brk
Tracing 1 functions for "t:syscalls:sys_enter_brk"... Hit Ctrl-C to end.
^C
[...]

  brk
  __sbrk
  __default_morecore
  sysmalloc
  _int_malloc
  tcache_init
  __libc_malloc
  malloc_hook_ini
  __libc_malloc
  JLI_MemAlloc
  JLI_List_new
  main
  __libc_start_main
  _start
    java [8395]
    1

  [unknown]
    cron [8385]
    2

This truncated output shows a brk(2) stack from a “java” process, from JLI_List_new(), JLI_MemAlloc(), and via sbrk(3): it looks as if a list object triggered a heap expansion. The second stack trace from cron is broken. For the java stack to work, I had to use a libc version with frame pointers. This is discussed further in Section 13.2.9 in Chapter 13.

brk(2) growths are infrequent, and the stack trace may reveal a large and unusual allocation that needed more space than was available, or a normal code path that happened to need one byte more than was available. The code path needs to be studied to determine which is the case. Because these growths are infrequent, the overhead of tracing them is negligible, making brk tracing an inexpensive technique for finding some clues about memory growth. In comparison, tracing the much more frequent memory allocation functions directly (e.g., malloc()) can be so expensive to instrument that the overhead is prohibitive. Another low-overhead tool for analyzing memory growth is faults(8), covered in Section 7.3.6, which traces page faults.

It can be easier to remember and find tools by their filename than to remember one-liners, so here is this important functionality implemented as a bpftrace tool, brkstack(8)5:

5 Origin: I created it for this book on 26-Jan-2019. Tracing brk() stacks is something I’ve done for years, and in the past I have published brk(2) flame graphs [82].

Click here to view code image


#!/usr/local/bin/bpftrace

tracepoint:syscalls:sys_enter_brk
{
        @[ustack, comm] = count();
}

7.3.5 shmsnoop
shmsnoop(8)6 is a BCC tool that traces System V shared memory syscalls: shmget(2), shmat(2), shmdt(2), and shmctl(2). It can be used for debugging shared memory usage. For example, during startup of a Java application:

6 Origin: This was created by Jiri Olsa on 8-Oct-2018.

Click here to view code image


# shmsnoop
PID    COMM        SYS          RET ARGs
12520  java           SHMGET    58c000a key: 0x0, size: 65536, shmflg: 0x380 (IPC_CREAT|0600)
12520  java      SHMAT 7fde9c033000 shmid: 0x58c000a, shmaddr: 0x0, shmflg: 0x0
12520  java     SHMCTL            0 shmid: 0x58c000a, cmd: 0, buf: 0x0
12520  java      SHMDT            0 shmaddr: 0x7fde9c033000
1863   Xorg      SHMAT 7f98cd3b9000 shmid: 0x58c000a, shmaddr: 0x0, shmflg: 0x1000
(SHM_RDONLY)
1863   Xorg     SHMCTL            0 shmid: 0x58c000a, cmd: 2, buf: 0x7ffdddd9e240
1863   Xorg      SHMDT            0 shmaddr: 0x7f98cd3b9000
[...]

This output shows Java allocating shared memory using shmget(2), followed by various shared-memory operations and their arguments. The return of shmget(2) is 0x58c000a, the identifier, which is used in subsequent calls by both Java and Xorg; in other words, they are sharing memory.

This tool works by tracing the shared memory syscalls, which should be infrequent enough that the overhead of the tool is negligible.

Command line usage:

Click here to view code image


shmsnoop [options]

Options include:

-T: Included timestamps

-p PID: Measured this process only

7.3.6 faults
Tracing page faults and their stack traces provides a particular view of memory usage: not the code paths that allocated memory, but the code paths that first used it and triggered a page fault. These page faults cause RSS growth, so the stack traces can explain why a process is growing. As with brk(), it’s possible to trace this event by using a one-liner with other tools, such as using BCC and stackcount(8) to frequency-count page user and kernel page faults with stack traces:

Click here to view code image


# stackcount -U t:exceptions:page_fault_user
# stackcount t:exceptions:page_fault_kernel

Example output, with -P for process details:

Click here to view code image


# stackcount -PU t:exceptions:page_fault_user
Tracing 1 functions for "t:exceptions:page_fault_user"... Hit Ctrl-C to end.
^C
[...]

  PhaseIdealLoop::Dominators()
  PhaseIdealLoop::build_and_optimize(LoopOptsMode)
  Compile::optimize_loops(PhaseIterGVN&, LoopOptsMode) [clone .part.344]
  Compile::Optimize()
  Compile::Compile(ciEnv*, C2Compiler*, ciMethod*, int, bool, bool, bool, Directiv...
  C2Compiler::compile_method(ciEnv*, ciMethod*, int, DirectiveSet*)
  CompileBroker::invoke_compiler_on_method(CompileTask*)
  CompileBroker::compiler_thread_loop()
  JavaThread::thread_main_inner()
  Thread::call_run()
  thread_native_entry(Thread*)
  start_thread
  __clone
    C2 CompilerThre [9124]
    1824

  __memset_avx2_erms
  PhaseCFG::global_code_motion()
  PhaseCFG::do_global_code_motion()
  Compile::Code_Gen()
  Compile::Compile(ciEnv*, C2Compiler*, ciMethod*, int, bool, bool, bool, Directiv...
  C2Compiler::compile_method(ciEnv*, ciMethod*, int, DirectiveSet*)
  CompileBroker::invoke_compiler_on_method(CompileTask*)
  CompileBroker::compiler_thread_loop()
  JavaThread::thread_main_inner()
  Thread::call_run()
  thread_native_entry(Thread*)
  start_thread
  __clone
    C2 CompilerThre [9124]
    2934

This output shows the start of a Java process and its C2 compiler thread faulting memory as it compiled code to instruction text.

Page Fault Flame Graphs
Page fault stack traces can be visualized as a flame graph to aid navigation. (Flame graphs are introduced in Chapter 2.) These instructions use my original flame graph software [37] and result in a page fault flame graph, an area of which is shown in Figure 7-5:

Click here to view code image


# stackcount -f -PU t:exceptions:page_fault_user > out.pagefaults01.txt
$ flamegraph.pl --hash --width=800 --title="Page Fault Flame Graph" \
    --colors=java --bgcolor=green < out.pagefaults01.txt > out.pagefaults01.svg


Figure 7-5 Page fault flame graph

This zoomed area shows the code paths from the Java compiler thread that grew main memory and triggered a page fault.

Netflix has automated page fault flame graph generation from Vector, an instance analysis tool, so that Netflix developers can generate these graphs with the click of a button (see Chapter 17).

bpftrace
For ease of use, here is a bpftrace tool, faults(8)7, for tracing page faults with stacks:

7 Origin: I created it for this book on 27-Jan-2019, and I’ve traced page fault stacks in the past with other tracers [82].

Click here to view code image


#!/usr/local/bin/bpftrace

software:page-faults:1
{
        @[ustack, comm] = count();
}

This tool instruments the software event page faults with an overflow count of one: it runs the BPF program for every page fault and frequency-counts the user-level stack trace and process name.

7.3.7 ffaults
ffaults(8)8 traces page faults by filename. For example, from a software build:

8 Origin: I created it for this book on 26-Jan-2019.

Click here to view code image


# ffaults.bt
Attaching 1 probe...

[...]
@[cat]: 4576
@[make]: 7054
@[libbfd-2.26.1-system.so]: 8325
@[libtinfo.so.5.9]: 8484
@[libdl-2.23.so]: 9137
@[locale-archive]: 21137
@[cc1]: 23083
@[ld-2.23.so]: 27558
@[bash]: 45236
@[libopcodes-2.26.1-system.so]: 46369
@[libc-2.23.so]: 84814
@[]: 537925

This output shows that the most page faults were to regions without a filename—which would be process heaps—with 537,925 faults occurring during tracing. The libc library encountered 84,814 faults while tracing. This is happening because the software build is creating many short-lived processes, which are faulting in their new address spaces.

The source to ffaults(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/mm.h>

kprobe:handle_mm_fault
{
        $vma = (struct vm_area_struct *)arg0;
        $file = $vma->vm_file->f_path.dentry->d_name.name;
        @[str($file)] = count();
}

This tool uses kprobes to trace the handle_mm_fault() kernel function and, from its arguments, determine the filename for the fault. The rate of file faults varies depending on the workload; you can check it using tools such as perf(1) or sar(1). For high rates, the overhead of this tool may begin to become noticeable.

7.3.8 vmscan
vmscan(8)9 uses the vmscan tracepoints to instrument the page-out daemon (kswapd), which frees memory for reuse when the system is under memory pressure. Note that, while the term scanner is still used to refer to this kernel function, for efficiency, Linux nowadays manages memory via linked lists of active and inactive memory.

9 Origin: I created it for this book on 26-Jan-2019. For an earlier tool that uses these tracepoints, see Mel Gorman’s trace-vmscan-postprocess.pl, which has been in the Linux source since 2009.

Running vmscan on a 36-CPU system while it runs out of memory:

Click here to view code image


# vmscan.bt
Attaching 10 probes...
TIME         S-SLABms  D-RECLAIMms  M-RECLAIMms KSWAPD WRITEPAGE
21:30:25            0            0            0      0         0
21:30:26            0            0            0      0         0
21:30:27          276          555            0      2         1
21:30:28         5459         7333            0     15        72
21:30:29           41            0            0     49        35
21:30:30            1          454            0      2         2
21:30:31            0            0            0      0         0
^C

@direct_reclaim_ns:
[256K, 512K)           5 |@                                                   |
[512K, 1M)            83 |@@@@@@@@@@@@@@@@@@@@@@@@                            |
[1M, 2M)             174 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[2M, 4M)             136 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@            |
[4M, 8M)              66 |@@@@@@@@@@@@@@@@@@@                                 |
[8M, 16M)             68 |@@@@@@@@@@@@@@@@@@@@                                |
[16M, 32M)             8 |@@                                                  |
[32M, 64M)             3 |                                                    |
[64M, 128M)            0 |                                                    |
[128M, 256M)           0 |                                                    |
[256M, 512M)          18 |@@@@@                                               |

@shrink_slab_ns:
[128, 256)         12228 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                    |
[256, 512)         19859 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[512, 1K)           1899 |@@@@                                                |
[1K, 2K)            1052 |@@                                                  |
[2K, 4K)             546 |@                                                   |
[4K, 8K)             241 |                                                    |
[8K, 16K)            122 |                                                    |
[16K, 32K)           518 |@                                                   |
[32K, 64K)           600 |@                                                   |
[64K, 128K)           49 |                                                    |
[128K, 256K)          19 |                                                    |
[256K, 512K)           7 |                                                    |
[512K, 1M)             6 |                                                    |
[1M, 2M)               8 |                                                    |
[2M, 4M)               4 |                                                    |
[4M, 8M)               7 |                                                    |
[8M, 16M)             29 |                                                    |
[16M, 32M)            11 |                                                    |
[32M, 64M)             3 |                                                    |
[64M, 128M)            0 |                                                    |
[128M, 256M)           0 |                                                    |
[256M, 512M)          19 |                                                    |

The per-second columns show:

S-SLABms: Total time in shrink slab, in milliseconds. This is reclaiming memory from various kernel caches.

D-RECLAIMms: Total time in direct reclaim, in milliseconds. This is foreground reclaim, which blocks memory allocations while memory is written to disk.

M-RECLAIMms: Total time in memory cgroup reclaim, in milliseconds. If memory cgroups are in use, this shows when one cgroup has exceeded its limit and its own cgroup memory is reclaimed.

KSWAPD: Number of kswapd wakeups.

WRITEPAGE: Number of kswapd page writes.

The times are totals across all CPUs, which provides a measure of cost beyond the counts seen by other tools, such as vmstat(1).

Look out for time in direct reclaims (D-RECLAIMms): This type of reclaim is “bad” but necessary, and will cause performance issues. It can hopefully be eliminated by tuning the other vm sysctl tunables to engage background reclaim sooner, before direct reclaim is necessary.

The output histograms show per-event times in direct reclaim and shrink slab, in nanoseconds.

The source to vmscan(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

tracepoint:vmscan:mm_shrink_slab_start { @start_ss[tid] = nsecs; }
tracepoint:vmscan:mm_shrink_slab_end /@start_ss[tid]/
{
        $dur_ss = nsecs - @start_ss[tid];
        @sum_ss = @sum_ss + $dur_ss;
        @shrink_slab_ns = hist($dur_ss);
        delete(@start_ss[tid]);
}

tracepoint:vmscan:mm_vmscan_direct_reclaim_begin { @start_dr[tid] = nsecs; }
tracepoint:vmscan:mm_vmscan_direct_reclaim_end /@start_dr[tid]/
{
        $dur_dr = nsecs - @start_dr[tid];
        @sum_dr = @sum_dr + $dur_dr;
        @direct_reclaim_ns = hist($dur_dr);
        delete(@start_dr[tid]);
}


tracepoint:vmscan:mm_vmscan_memcg_reclaim_begin { @start_mr[tid] = nsecs; }
tracepoint:vmscan:mm_vmscan_memcg_reclaim_end /@start_mr[tid]/
{
        $dur_mr = nsecs - @start_mr[tid];
        @sum_mr = @sum_mr + $dur_mr;
        @memcg_reclaim_ns = hist($dur_mr);
        delete(@start_mr[tid]);
}
tracepoint:vmscan:mm_vmscan_wakeup_kswapd { @count_wk++; }

tracepoint:vmscan:mm_vmscan_writepage { @count_wp++; }

BEGIN
{
        printf("%-10s %10s %12s %12s %6s %9s\n", "TIME",
            "S-SLABms", "D-RECLAIMms", "M-RECLAIMms", "KSWAPD", "WRITEPAGE");

}

interval:s:1
{
        time("%H:%M:%S");
        printf("   %10d %12d %12d %6d %9d\n",
            @sum_ss / 1000000, @sum_dr / 1000000, @sum_mr / 1000000,
            @count_wk, @count_wp);
        clear(@sum_ss);
        clear(@sum_dr);
        clear(@sum_mr);
        clear(@count_wk);
        clear(@count_wp);
}

This tool uses various vmscan tracepoints to record times when events begin so that duration histograms and running totals can be maintained.

7.3.9 drsnoop
drsnoop(8)10 is a BCC tool for tracing the direct reclaim approach to freeing memory, showing the process affected and the latency: the time taken for the reclaim. It can be used to quantify the application performance impact of a memory-constrained system. For example:

10 Origin: This was created by Ethercflow on 10-Feb-2019.

Click here to view code image


# drsnoop -T
TIME(s)       COMM           PID     LAT(ms) PAGES
0.000000000   java           11266      1.72    57
0.004007000   java           11266      3.21    57
0.011856000   java           11266      2.02    43
0.018315000   java           11266      3.09    55
0.024647000   acpid          1209       6.46    73
[...]

This output shows some direct reclaims for Java, taking between one and seven milliseconds. The rates of these reclaims and their duration can be considered in quantifying the application impact.

This tool works by tracing the vmscan mm_vmscan_direct_reclaim_begin and mm_vmscan_direct_reclaim_end tracepoints. These are expected to be low-frequency events (usually happening in bursts), so the overhead should be negligible.

Command line usage:

Click here to view code image


drsnoop [options]

Options include:

-T: Includes timestamps

-p PID: Measures this process only

7.3.10 swapin
swapin(8)11 shows which processes are being swapped in from the swap devices, if they exist and are in use. For example, this system swapped out some memory and had 36 Kbytes swapped back in (“si” column) while I was watching it with vmstat(1):

11 Origin: I first created a similar tool called anonpgpid.d on 25-Jul-2005, with help from James Dickens. This was one of the long-standing performance issues I wrestled with beforehand: I could see that the system was swapping, but I wanted to show which processes were affected. I created this bpftrace version for this book on 26-Jan-2019.

Click here to view code image


# vmstat 1
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
[...]
46 11  29696 1585680   4384 1828440    0    0 88047  2034 21809 37316 81 18  0  1  0
776 57  29696 2842156   7976 1865276   36    0 52832  2283 18678 37025 85 15  0  1  0
294 135  29696 448580   4620 1860144    0    0 36503  5393 16745 35235 81 19  0  0  0
[...]

swapin(8) identifies the process that was swapped in. At the same time:

Click here to view code image


# swapin.bt
Attaching 2 probes...

[...]
06:57:43

06:57:44
@[systemd-logind, 1354]: 9

06:57:45
[...]

This output shows that systemd-logind (PID 1354) had 9 swap-ins. With a 4 Kbyte page size, this adds up to the 36 Kbytes seen in vmstat(1). I logged into the system using ssh(1), and this component in the login software had been swapped out, so the login took longer than usual.

Swap-ins occur when an application tries to use memory that has been moved to the swap device. This is an important measure of the performance pain suffered by an application due to swapping. Other swap metrics, like scanning and swap-outs, may not directly affect application performance.

The source to swapin(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

kprobe:swap_readpage
{
        @[comm, pid] = count();
}

interval:s:1
{
        time();
        print(@);
        clear(@);
}

This tool uses kprobes to trace the swap_readpage() kernel function, which runs in the context of the swapping thread, so the bpftrace built-ins for comm and pid reflect the swapping process.

7.3.11 hfaults
hfaults(8)12 traces huge page faults by their process details and can be used to confirm that huge pages are in use. For example:

12 Origin: Amer Ather created it for this book on 6-May-2019.

Click here to view code image


# hfaults.bt
Attaching 2 probes...
Tracing Huge Page faults per process... Hit Ctrl-C to end.
^C
@[884, hugemmap]: 9

This output includes a test program, hugemmap, with PID 884, which triggered nine huge page faults.

The source to hfaults(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing Huge Page faults per process... Hit Ctrl-C to end.\n");
}

kprobe:hugetlb_fault
{
        @[pid, comm] = count();
}

If needed, more details can be fetched from function arguments, including struct mm_struct and struct vm_area_struct. The ffaults(8) tool (see Section 7.3.7) fetched the filename from the vm_area_struct.

7.3.12 Other Tools
Two other BPF tools are worth mentioning:

llcstat(8) from BCC is covered in Chapter 5; it shows the last-level cache hit ratio, by process.

profile(8) from BCC is covered in Chapter 5; it samples stack traces and can be used as a coarse and cheap way to find malloc() code paths.

7.4 BPF ONE-LINERS
This section shows BCC and bpftrace one-liners. Where possible, the same one-liner is implemented using both BCC and bpftrace.

7.4.1 BCC
Count process heap expansion (brk()) by user-level stack trace:

Click here to view code image

stackcount -U t:syscalls:sys_enter_brk
Count user page faults by user-level stack trace:

Click here to view code image

stackcount -U t:exceptions:page_fault_user
Count vmscan operations by tracepoint:

Click here to view code image

funccount 't:vmscan:*'
Show hugepage_madvise() calls by process:

Click here to view code image

trace hugepage_madvise
Count page migrations:

Click here to view code image

funccount t:migrate:mm_migrate_pages
Trace compaction events:

Click here to view code image

trace t:compaction:mm_compaction_begin
7.4.2 bpftrace
Count process heap expansion (brk()) by code path:

Click here to view code image

bpftrace -e tracepoint:syscalls:sys_enter_brk { @[ustack, comm] = count(); }
Count page faults by process:

Click here to view code image

bpftrace -e 'software:page-fault:1 { @[comm, pid] = count(); }'
Count user page faults by user-level stack trace:

Click here to view code image

bpftrace -e 'tracepoint:exceptions:page_fault_user { @[ustack, comm] = count(); }'
Count vmscan operations by tracepoint:

Click here to view code image

bpftrace -e 'tracepoint:vmscan:* { @[probe] = count(); }'
Show hugepage_madvise() calls by process:

Click here to view code image

bpftrace -e 'kprobe:hugepage_madvise { printf("%s by PID %d\n", probe, pid); }'
Count page migrations:

Click here to view code image

bpftrace -e 'tracepoint:migrate:mm_migrate_pages { @ = count(); }'
Trace compaction events:

Click here to view code image

bpftrace -e 't:compaction:mm_compaction_begin { time(); }'
7.5 OPTIONAL EXERCISES
If not specified, these can be completed using either bpftrace or BCC:

Run vmscan(8) for ten minutes on a production or local server. If any time was spent in direct reclaim (D-RECLAIMms), also run drsnoop(8) to measure this on a per-event basis.

Modify vmscan(8) to print the header every 20 lines so that it remains onscreen.

During application startup (either a production or desktop application) use fault(8) to count page fault stack traces. This may involve fixing or finding an application that supports stack traces and symbols (see Chapters 13 and 18).

Create a page fault flame graph from the output of Exercise 3.

Develop a tool to trace process virtual memory growth via both brk(2) and mmap(2).

Develop a tool to print the size of expansions via brk(2). It may use syscall tracepoints, kprobes, or libc USDT probes, as desired.

Develop a tool to show the time spent in page compaction. You can use the compaction:mm_compaction_begin and compaction:mm_compaction_end tracepoints. Print the time per event and summarize it as a histogram.

Develop a tool to show time spent in shrink slab, broken down by slab name (or shrinker function name).

Use memleak(8) to find long-term survivors on some sample software in a test environment. Also estimate the performance overhead with and without memleak(8) running.

(Advanced, unsolved) Develop a tool to investigate swap thrashing: Show the time spent by pages on the swap device as a histogram. This is likely to involve measuring the time from swap-out to swap-in.

7.6 SUMMARY
This chapter summarizes how virtual and physical memory is used by processes and covers memory analysis using traditional tools, which focus on showing memory volumes by usage types. This chapter also shows how to use BPF tools to measure rates and time durations for memory activity by the OOM killer, user-level allocations, memory maps, page faults, vmscan, direct reclaim, and swap-ins.

CopyAdd HighlightAdd Note
back to top
