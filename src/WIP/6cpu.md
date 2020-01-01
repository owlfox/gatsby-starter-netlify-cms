Chapter 6. CPUs
CPUs execute all software and are a common starting point for performance analysis. If you find a workload to be limited by the CPUs (“CPU bound”), you can investigate further by using CPU and processor-centric tools. There are countless sampling profilers and metrics available to help you understand CPU usage. Nonetheless (if perhaps surprisingly), there are still a number of areas where BPF tracing can help even further with CPU analysis.

Learning Objectives:

Understand CPU modes, the behavior of the CPU scheduler, and CPU caches

Understand areas for CPU scheduler, usage, and hardware analysis with BPF

Learn a strategy for successful analysis of CPU performance

Solve issues of short-lived processes consuming CPU resources

Discover and quantify issues of run queue latency

Determine CPU usage through profiled stack traces and function counts

Determine reasons why threads block and leave the CPU

Understand system CPU time by tracing syscalls

Investigate CPU consumption by soft and hard interrupts

Use bpftrace one-liners to explore CPU usage in custom ways

This chapter begins with the background you need to understand CPU analysis, summarizing the behavior of the CPU scheduler and CPU caches. I explore what questions BPF can answer, and provide an overall strategy to follow. To avoid reinventing the wheel and to direct further analysis, I first summarize traditional CPU tools, then BPF tools, including a list of BPF one-liners. This chapter ends with optional exercises.

6.1 BACKGROUND
This section covers CPU fundamentals, BPF capabilities, and a suggested strategy for CPU analysis.

6.1.1 CPU Fundamentals
CPU Modes
CPUs and other resources are managed by the kernel, which runs in a special privileged state called system mode. User-level applications run in user mode, which can only access resources through kernel requests. These requests can be explicit, such as system calls, or implicit, such as page faults triggered by memory loads and stores. The kernel tracks the amount of time that the CPUs are not idle, as well as CPU time spent in user mode and system mode. Various performance tools show this user/system time split.

The kernel usually only runs on demand, triggered by syscalls and interrupts. There are some exceptions, such as housekeeping threads that run in the background, consuming CPU resources. An example of this is a kernel routine to balance memory pages on non-uniform memory access (NUMA) systems, which can consume significant CPU resources without an explicit request from user-level applications. (This can be tuned or disabled.) Some file systems also have background routines, such as for periodically verifying checksums for data integrity.

CPU Scheduler
The kernel is also responsible for sharing CPU resources between consumers, which it manages via a CPU scheduler. The main consumers are threads (also called tasks) which belong to processes or kernel routines. Other CPU consumers include interrupt routines: These can be soft interrupts triggered by running software or hard interrupts triggered by hardware.

Figure 6-1 shows the CPU scheduler, picturing threads waiting their turn on run queues and how they move between different thread states.


Figure 6-1 CPU scheduler

Three thread states are pictured in this diagram: ON-PROC for threads that are running on a CPU, RUNNABLE for threads that could run but are awaiting their turn, and SLEEP for threads that are blocked on another event, including uninterruptible waits. Threads waiting on a run queue are sorted by a priority value, which can be set by the kernel or by user processes to improve the performance of more important tasks. (Run queues are how scheduling was originally implemented, and the term and mental model are still used to describe waiting tasks. However, the Linux CFS scheduler actually uses a red/black tree of future task execution.)

This book uses terminology based on these thread states: “on CPU” refers to ON-PROC, and “off CPU” refers to all other states, where the thread is not running on a CPU.

Threads leave the CPU in one of two ways: (1) voluntary, if they block on I/O, a lock, or a sleep; or (2) involuntary, if they have exceeded their scheduled allocation of CPU time and are descheduled so that other threads can run or if they are preempted by a higher-priority thread. When a CPU switches from running one process or thread to another, it switches address spaces and other metadata; this is called a context switch.1

1 There are also mode switches: Linux syscalls that do not block may only (depending on the processor) need to switch modes between user- and kernel-mode.

Figure 6-1 also pictures thread migrations. If a thread is in the runnable state and sitting in a run queue while another CPU is idle, the scheduler may migrate the thread to the idle CPU’s run queue so that it can execute sooner. As a performance optimization, the scheduler uses logic to avoid migrations when the cost is expected to exceed the benefit, preferring to leave busy threads running on the same CPU where the CPU caches should still be warm.

CPU Caches
Whereas Figure 6-1 shows a software view of CPUs (the scheduler), Figure 6-2 provides a hardware view of the CPU caches.


Figure 6-2 Hardware caches

Depending on the processor model and type, there are typically multiple levels of CPU cache, increasing in both size and latency. They begin with the Level 1 cache, which is split into separate instruction (I$) and data (D$) caches and is also small (Kbytes) and fast (nanoseconds). The caches end with the last-level cache (LLC), which is large (Mbytes) and much slower. On a processor with three levels of caches, the LLC is also the Level 3 cache. The Level 1 and 2 caches are usually per CPU core, and the Level 3 cache is usually shared across the socket. The memory management unit (MMU) responsible for translating virtual to physical addresses also has its own cache, the translation lookaside buffer (TLB).

CPUs have been scaling for decades by increasing clock speed, adding cores, and adding more hardware threads. Memory bandwidth and latency have also improved, especially by adding and increasing the size of CPU caches. However, memory performance has not scaled to the same degree as the CPUs. Workloads have become limited by memory performance (termed “memory-bound”) rather than the CPU cores.

Further Reading
This has been a brief summary to arm you with some essential knowledge before you use the tools. CPU software and hardware are covered in much more depth in Chapter 6 of Systems Performance [Gregg 13b].

6.1.2 BPF Capabilities
Traditional performance tools provide various insights for CPU usage. For example, they can show CPU utilization by process, context switch rates, and run queue lengths. These traditional tools are summarized in the next section.

BPF tracing tools can provide many additional details, answering:

What new processes are created? What is their lifespan?

Why is system time high? Are syscalls the culprit? What are they doing?

How long do threads spend on-CPU for each wakeup?

How long do threads spend waiting on the run queues?

What is the maximum length of the run queues?

Are the run queues balanced across the CPUs?

Why are threads voluntarily leaving the CPU? For how long?

What soft and hard IRQs are consuming CPUs?

How often are CPUs idle when work is available on other run queues?

What is the LLC hit ratio, by application request?

These questions can be answered using BPF by instrumenting tracepoints for scheduler and syscall events, kprobes for scheduler internal functions, uprobes for application-level functions, and PMCs for timed sampling and low-level CPU activity. These event sources can also be mixed: A BPF program could use uprobes to fetch application context and then associate that with instrumented PMC events. Such a program could show the LLC hit ratio by application request, for example.

Metrics that BPF provides can be examined per event or as summary statistics, with distributions shown as histograms. Stack traces can also be fetched to show the reasons for events. All these activities have been optimized using in-kernel BPF maps and output buffers for efficiency.

Event Sources
Table 6-1 lists the event sources for instrumenting CPU usage.

Table 6-1 Event Sources for Instrumenting CPUs

Event Type

Event Source

Kernel functions

kprobes, kretprobes

User-level functions

uprobes, uretprobes

System calls

syscall tracepoints

Soft interrupts

irq:softirq* tracepoints

Hard interrupts

irq:irq_handler* tracepoints

Workqueue events

workqueue tracepoints (see Chapter 14)

Timed sampling

PMC- or timer-based sampling

CPU power events

power tracepoints

CPU cycles

PMCs

Overhead
When tracing scheduler events, efficiency is especially important because scheduler events such as context switches may occur millions of times per second. While BPF programs are short and fast (microseconds), executing them for every context switch may cause this tiny overhead to add up to something measurable, or even significant. In the worst case, scheduler tracing can add over 10% overhead to a system. If BPF were not optimized, this overhead would be prohibitively high.

Scheduler tracing with BPF can be used for short-term, ad hoc analysis, with the understanding that there will be overhead. Such overhead can be quantified using testing or experimentation to determine: If CPU utilization is steady from second to second, what is it when the BPF tool is running and not running?

CPU tools can avoid overhead by not instrumenting frequent scheduler events. Infrequent events, such as process execution and thread migrations (with at most thousands of events per second) can be instrumented with negligible overhead. Profiling (timed sampling) also limits overhead to the fixed rate of samples, reducing overhead to negligible proportions.

6.1.3 Strategy
If you are new to CPU performance analysis, it can be difficult to know where to start—which target to begin analyzing and with which tool. Here is a suggested overall strategy that you can follow:

Ensure that a CPU workload is running before you spend time with analysis tools. Check system CPU utilization (e.g., using mpstat(1)) and ensure that all the CPUs are still online (and some haven’t been offlined for some reason).

Confirm that the workload is CPU bound.

Look for high CPU utilization system-wide or on a single CPU (e.g., using mpstat(1)).

Look for high run queue latency (e.g., using BCC runqlat(1)). Software limits such as those used by containers can artificially limit the CPU available to processes, so an application may be CPU bound on a mostly idle system. This counterintuitive scenario can be identified by studying run queue latency.

Quantify CPU usage as percent utilization system-wide and then broken down by process, CPU mode, and CPU ID. This can be done using traditional tools (e.g., mpstat(1), top(1)). Look for high utilization by a single process, mode, or CPU.

For high system time, frequency-count system calls by process and call type, and also examine arguments to look for inefficiencies (e.g., using perf(1), bpftrace one-liners, and BCC sysstat(8)).

Use a profiler to sample stack traces, which can be visualized using a CPU flame graph. Many CPU issues can be found by browsing such flame graphs.

For CPU consumers identified by profilers, consider writing custom tools to show more context. Profilers show the functions that are running but not the arguments and objects they are operating on, which may be needed to understand CPU usage. Examples:

Kernel mode: If a file system is consuming CPU resources doing stat() on files, what are their filenames? (This could be determined, for example, using BCC statsnoop(8) or in general using tracepoints or kprobes from BPF tools.)

User-mode: If an application is busy processing requests, what are the requests? (If an application-specific tool is unavailable, one could be developed using USDT or uprobes and BPF tools).

Measure time in hardware interrupts, since this time may not be visible in timer-based profilers (e.g., BCC hardirqs(1)).

Browse and execute the BPF tools listed in the BPF tools section of this chapter.

Measure CPU instructions per cycle (IPC) using PMCs to explain at a high level how much the CPUs are stalled (e.g., using perf(1)). This can be explored with more PMCs, which may identify low cache hit ratios (e.g., BCC llcstat), temperature stalls, and so on.

The following sections explain the tools involved in this process in more detail.

6.2 TRADITIONAL TOOLS
Traditional tools (see Table 6-2) can provide CPU utilization metrics for each process (thread) and for each CPU, voluntary and involuntary context switch rates, the average run queue length, and the total time spent waiting on run queues. Profilers can show and quantify the software that is running, and PMC-based tools can show how well the CPUs are operating at the cycle level.

Apart from solving issues, traditional tools can also provide clues to direct your further use of BPF tools. They have been categorized here based on their source and measurement type: kernel statistics, hardware statistics, and event tracing.

Table 6-2 Traditional Tools

Tool

Type

Description

uptime

Kernel statistics

Shows load averages and system uptime

top

Kernel statistics

Shows CPU time by process and CPU mode times system-wide

mpstat

Kernel statistics

Shows CPU mode time by CPU

perf

Kernel statistics, hardware statistics, event tracing

Profiles (timed sampling) of stack traces and event statistics and tracing of PMCs, tracepoints, USDT probes, kprobes, and uprobes

Ftrace

Kernel statistics, event tracing

Reports kernel function count statistics and event tracing of kprobes and uprobes

The following sections summarize key functionality of these tools. Refer to their man pages and other resources, including Systems Performance [Gregg 13b], for more usage and explanations.

6.2.1 Kernel Statistics
Kernel statistics tools use statistical sources in the kernel, often exposed via the /proc interface. An advantage of these tools is that the metrics are usually enabled by the kernel, so there is little additional overhead in using them. They can also often be read by non-root users.

Load Averages
uptime(1) is one of several commands that print the system load averages:

Click here to view code image


$ uptime
   00:34:10 up  6:29,  1 user,  load average: 20.29, 18.90, 18.70

The last three numbers are the 1-, 5-, and 15-minute load averages. By comparing these numbers, you can determine whether the load has been increasing, decreasing, or steady during the past 15 minutes or so. This output is from a 48-CPU production cloud instance and shows that load is increasing slightly when comparing 1-minute (20.29) to 15-minutes (18.70) load averages.

The load averages are not simple averages (means) but are exponentially damped moving sums, and reflect time beyond 1, 5, and 15 minutes. The metrics that these summarize show demand on the system: tasks in the CPU runnable state, as well as tasks in the uninterruptible wait state [72]. If you assume that the load averages are showing CPU load, you can divide them by the CPU count to see whether the system is running at CPU saturation, which would be indicated by a ratio of over 1.0. However, a number of problems with load averages, including their inclusion of uninterruptible tasks (tasks blocked in disk I/O and locks) cast doubt on this interpretation, so they are only really useful for looking at trends over time. You must use other tools, such as the BPF-based offcputime(8), to see if the load is CPU or uninterruptible time based. See Section 6.3.9 for information on offcputime(8) and Chapter 14 for more on measuring uninterruptible I/O.

top
The top(1) tool shows top CPU-consuming processes in a table of process details, along with a header summary of the system:

Click here to view code image


$ top
top - 00:35:49 up  6:31,  1 user,  load average: 21.35, 19.96, 19.12
Tasks: 514 total,   1 running, 288 sleeping,   0 stopped,   0 zombie
%Cpu(s): 33.2 us,  1.4 sy,  0.0 ni, 64.9 id,  0.0 wa,  0.0 hi,  0.4 si,  0.0 st
KiB Mem : 19382528+total,  1099228 free, 18422233+used,  8503712 buff/cache
KiB Swap:        0 total,        0 free,        0 used.  7984072 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU %MEM      TIME+ COMMAND
 3606 www       20   0  0.197t 0.170t  38776 S  1681 94.2    7186:36 java
 5737 snmp      20   0   22712   6676   4256 S   0.7  0.0    0:57.96 snmp-pass
  403 root      20   0       0      0      0 I   0.3  0.0    0:00.17 kworker/41:1
  983 root      20   0    9916    128      0 S   0.3  0.0    1:29.95 rngd
29535 bgregg    20   0   41020   4224   3072 R   0.3  0.0    0:00.11 top
    1 root      20   0  225308   8988   6656 S   0.0  0.0    0:03.09 systemd
    2 root      20   0       0      0      0 S   0.0  0.0    0:00.01 kthreadd
[...]

This output is from a production instance and shows only one process that is CPU busy: A java process that is consuming a total of 1681% CPU, summed across all CPUs. For this 48-CPU system, the output shows that this java process is consuming 35% of overall CPU capacity. This concurs with the system-wide CPU average of 34.6% (shown in the header summary: 33.2% user and 1.4% system).

top(1) is especially useful for identifying issues of CPU load by an unexpected process. A common type of software bug causes a thread to become stuck in an infinite loop, which is easily found using top(1) as a process running at 100% CPU. Further analysis with profilers and BPF tools can confirm that the process is stuck in a loop, rather than busy processing work.

top(1) refreshes the screen by default so that the screen acts as a real-time dashboard. This is a problem: Issues can appear and then disappear before you are able to collect a screenshot. It can be important to add tool output and screenshots to ticketing systems to track work on performance issues and to share the information with others. Tools such as pidstat(1) can be used to print rolling output of process CPU usage for this purpose; CPU usage by process may also be already recorded by monitoring systems, if they are in use.

There are other top(1) variants, such as htop(1), that have more customization options. Unfortunately, many top(1) variants focus on visual enhancements rather than performance metrics, making them prettier but unable to shed light on issues beyond the original top(1). Exceptions include tiptop(1), which sources PMCs; atop(1), which uses process events to display short-lived processes; and the biotop(8) and tcptop(8) tools, which use BPF (and which I developed).

mpstat(1)
mpstat(1) can be used to examine per-CPU metrics:

Click here to view code image


$ mpstat -P ALL 1
Linux 4.15.0-1027-aws (api-...)     01/19/2019     _x86_64_      (48 CPU)

12:47:47 AM  CPU   %usr  %nice  %sys %iowait  %irq  %soft %steal %guest %gnice  %idle
12:47:48 AM  all  35.25   0.00  1.47    0.00  0.00   0.46   0.00   0.00   0.00  62.82
12:47:48 AM    0  44.55   0.00  1.98    0.00  0.00   0.99   0.00   0.00   0.00  52.48
12:47:48 AM    1  33.66   0.00  1.98    0.00  0.00   0.00   0.00   0.00   0.00  64.36
12:47:48 AM    2  30.21   0.00  2.08    0.00  0.00   0.00   0.00   0.00   0.00  67.71
12:47:48 AM    3  31.63   0.00  1.02    0.00  0.00   0.00   0.00   0.00   0.00  67.35
12:47:48 AM    4  26.21   0.00  0.00    0.00  0.00   0.97   0.00   0.00   0.00  72.82
12:47:48 AM    5  68.93   0.00  1.94    0.00  0.00   3.88   0.00   0.00   0.00  25.24
12:47:48 AM    6  26.26   0.00  3.03    0.00  0.00   0.00   0.00   0.00   0.00  70.71
12:47:48 AM    7  32.67   0.00  1.98    0.00  0.00   1.98   0.00   0.00   0.00  63.37
[...]

This output has been truncated because on this 48-CPU system it prints 48 lines of output per second: 1 line to summarize each CPU. This output can be used to identify issues of balance, where some CPUs have high utilization while others are idle. A CPU imbalance can occur for a number of reasons, such as misconfigured applications with a thread pool size too small to utilize all CPUs; software limits that limit a process or container to a subset of CPUs; and software bugs.

Time is broken down across the CPUs into many modes, including time in hard interrupts (%irq) and time in soft interrupts (%soft). These can be further investigated using the hardirqs(8) and softirqs(8) BPF tools.

6.2.2 Hardware Statistics
Hardware can also be a useful source of statistics—especially the performance monitoring counters (PMCs) available on the CPUs. PMCs were introduced in Chapter 2.

perf(1)
Linux perf(1) is a multi-tool that supports different instrumentation sources and presentations of data. First added to Linux in 2.6.31 (2009), it is considered the standard Linux profiler, and its code can be found in the Linux source code under tools/perf. I’ve published a detailed guide on how to use perf [73]. Among its many powerful capabilities is the ability to use PMCs in counting mode:

Click here to view code image


$ perf stat -d gzip file1

 Performance counter stats for 'gzip file1':

    3952.239208  task-clock (msec)     #   0.999 CPUs utilized
              6  context-switches      #   0.002 K/sec
              0  cpu-migrations        #   0.000 K/sec
            127  page-faults           #   0.032 K/sec
 14,863,135,172  cycles                #   3.761 GHz                   (62.35%)
 18,320,918,801  instructions          #   1.23  insn per cycle        (74.90%)
  3,876,390,410  branches              # 980.809 M/sec                 (74.90%)
    135,062,519  branch-misses         #   3.48% of all branches       (74.97%)
  3,725,936,639  L1-dcache-loads       # 942.741 M/sec                 (75.09%)
    657,864,906  L1-dcache-load-misses #  17.66% of all L1-dcache hits (75.16%)
     50,906,146  LLC-loads             #  12.880 M/sec                 (50.01%)
      1,411,636  LLC-load-misses       #   2.77% of all LL-cache hits  (49.87%)

The perf stat command counts events specified with -e arguments. If no such arguments are supplied, it defaults to a basic set of PMCs, or it uses an extended set if -d is used, as shown here. The output and usage varies a little depending on the version of Linux you are using and the PMCs available for your processor type. This example shows perf(1) on Linux 4.15.

Depending on your processor type and perf version, you may find a detailed list of PMCs by using perf list:

Click here to view code image


$ perf list
[...]
  mem_load_retired.l3_hit
       [Retired load instructions with L3 cache hits as data sources Supports address
when precise (Precise event)]
  mem_load_retired.l3_miss
       [Retired load instructions missed L3 cache as data sources Supports address
when precise (Precise event)]
[...]

This output shows the alias names you can use with -e. For example, you can count these events on all CPUs (using -a, which recently became the default) and print output with an interval of 1000 milliseconds (-I 1000):

Click here to view code image


# perf stat -e mem_load_retired.l3_hit -e mem_load_retired.l3_miss -a -I 1000
#           time             counts unit events
     1.001228842            675,693      mem_load_retired.l3_hit
     1.001228842            868,728      mem_load_retired.l3_miss
     2.002185329            746,869      mem_load_retired.l3_hit
     2.002185329            965,421      mem_load_retired.l3_miss
     3.002952548          1,723,796      mem_load_retired.l3_hit
[...]

This output shows per-second rates for these events system-wide.

There are hundreds of PMCs available, documented in the processor vendor guides [Intel 16] [AMD 10]. You can use PMCs together with model-specific registers (MSRs) to determine how CPU internal components are performing, the current clock rates of the CPUs, their temperatures and energy consumption, the throughput on CPU interconnects and memory buses, and more.

tlbstat
As an example use of PMCs, I developed the tlbstat tool to count and summarize translation lookaside buffer (TLB)–related PMCs. My goal was to analyze the performance impact of the Linux kernel page table isolation (KPTI) patches that work around the Meltdown vulnerability [74] [75]:

Click here to view code image


# tlbstat -C0 1
K_CYCLES  K_INSTR   IPC DTLB_WALKS ITLB_WALKS K_DTLBCYC  K_ITLBCYC  DTLB% ITLB%
2875793   276051   0.10 89709496   65862302   787913     650834     27.40 22.63
2860557   273767   0.10 88829158   65213248   780301     644292     27.28 22.52
2885138   276533   0.10 89683045   65813992   787391     650494     27.29 22.55
2532843   243104   0.10 79055465   58023221   693910     573168     27.40 22.63
[...]

tlbstat prints the following columns:

K_CYCLES: CPU cycles (in lots of 1000)

K_INSTR: CPU Instructions (in lots of 1000)

IPC: Instructions per cycle

DTLB_WALKS: Data TLB walks (count)

ITLB_WALKS: Instruction TLB walks (count)

K_DTLBCYC: Cycles (in lots of 1000) when at least one page-miss handler (PMH) is active with data TLB walks

K_ITLBCYC: Cycles (in lots of 1000) when at least one PMH is active with instruction TLB walks

DTLB%: Data TLB active cycles as a ratio of total cycles

ITLB%: Instruction TLB active cycles as a ratio of total cycles

The output shown earlier is from a stress test where the KPTI overhead was the worst: It shows 27% of CPU cycles in the DTLB and 22% in the ITLB. This means that half of the system-wide CPU resources were consumed by the memory management unit servicing virtual-to-physical address translations. If tlbstat showed similar numbers for production workloads, you would want to direct your tuning efforts toward the TLB.

6.2.3 Hardware Sampling
perf(1) can use PMCs in a different mode, where a count is chosen and, at a rate of one in every count, a PMC event causes an interrupt to be sent to the kernel so that it can capture event state. For example, the command below records the stack trace (-g) for L3 cache-miss events (-e ...) on all CPUs (-a) for 10 seconds (sleep 10, a dummy command used to set the duration):

Click here to view code image


# perf record -e mem_load_retired.l3_miss -c 50000 -a -g -- sleep 10
[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 3.355 MB perf.data (342 samples) ]

The samples can be summarized using perf report or dumped using perf list:

Click here to view code image


# perf list
kworker/u17:4 11563 [007] 2707575.286552: mem_load_retired.l3_miss:
            7fffba5d8c52 move_freepages_block ([kernel.kallsyms])
            7fffba5d8e02 steal_suitable_fallback ([kernel.kallsyms])
            7fffba5da4a8 get_page_from_freelist ([kernel.kallsyms])
            7fffba5dc3fb __alloc_pages_nodemask ([kernel.kallsyms])
            7fffba63a8ea alloc_pages_current ([kernel.kallsyms])
            7fffc01faa5b crypt_page_alloc ([kernel.kallsyms])
            7fffba5d3781 mempool_alloc ([kernel.kallsyms])
            7fffc01fd870 kcryptd_crypt ([kernel.kallsyms])
            7fffba4a983e process_one_work ([kernel.kallsyms])
            7fffba4a9aa2 worker_thread ([kernel.kallsyms])
            7fffba4b0661 kthread ([kernel.kallsyms])
            7fffbae02205 ret_from_fork ([kernel.kallsyms])
[...]

This output shows a single stack trace sample. The stack is listed in order from child to parent, and in this case it shows the kernel functions that led to the L3 cache-miss event.

Note that you will want to use PMCs that support precise event-based sampling (PEBS) wherever possible to minimize issues of interrupt skid.

PMC hardware sampling can also trigger BPF programs. For example, instead of dumping all sampled stack traces to user space via the perf buffer, BPF can frequency-count them in kernel context to improve efficiency.

6.2.4 Timed Sampling
Many profilers support timer-based sampling (capturing the instruction pointer or stack trace at a timed interval). Such profilers provide a coarse, cheap-to-collect view of which software is consuming CPU resources. There are different types of profilers, some operating in user mode only and some in kernel mode. Kernel-mode profilers are usually preferred, as they can capture both kernel- and user-level stacks, providing a more complete picture.

perf
perf(1) is a kernel-based profiler that supports timed sampling through software events or PMCs: it defaults to the most accurate technique available. In this example, it is capturing stacks across all CPUs at 99 Hertz (samples per second per CPU) for 30 seconds:

Click here to view code image


# perf record -F 99 -a -g -- sleep 30
[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 0.661 MB perf.data (2890 samples) ]

99 Hertz was chosen instead of 100 to avoid lockstep sampling with other software routines, which would otherwise skew the samples. (This is explained in more detail in Chapter 18.) Roughly 100 was chosen instead of, say, 10 or 10,000 as a balance between detail and overhead: Too low, and you don’t get enough samples to see the full picture of execution, including large and small code paths; too high, and the overhead of samples skews performance and results.

When this perf(1) command is run, it writes the samples to a perf.data file: this has been optimized by use of a kernel buffer and an optimal number of writes to the file system. The output tells us it only needed to wake up once to write this data.

The output can be summarized using perf report, or each sample can be dumped using perf script. For example:

Click here to view code image


# perf report -n --stdio
[...]
# Children      Self       Samples  Command  Shared Object       Symbol
# ........  ........  ............  .......  ..................  .....................
.........................
#
    99.41%     0.08%             2  iperf    libpthread-2.27.so  [.] __libc_write
            |
             --99.33%--__libc_write
                       |
                        --98.51%--entry_SYSCALL_64_after_hwframe
                                  |
                                   --98.38%--do_syscall_64
                                             |
                                              --98.29%--sys_write
                                                        |
                                                         --97.78%--vfs_write
                                                                   |
[...]

The perf report summary shows a tree of functions from root to child. (The order can be reversed, as it was by default in earlier versions.) Unfortunately, there is not much conclusive to say from this sample of output—and the full output was six thousand lines. The full output of perf script, dumping every event, was over sixty thousand lines. These profiles can easily be 10 times this size on busier systems. A solution in such a case is to visualize the stack samples as a flame graph.

CPU Flame Graphs
Flame graphs, introduced in Chapter 2, enable visualization of stack traces. They are well suited for CPU profiles and are now commonly used for CPU analysis.

The flame graph in Figure 6-3 summarizes the same profile data captured in the previous section.


Figure 6-3 CPU flame graph

When this data is presented as a flame graph, it is easy to see that the process named iperf was consuming all CPU and exactly how: via sock_sendmsg(), which led to two hot on-CPU functions, copy_user_enhanced_fast_string() and move_freepages_block(), seen as the two plateaus. On the right is a tower that continues back into the TCP receive path; this is iperf doing a loopback test.

Below are the steps to create CPU flame graphs using perf(1) to sample stacks at 49 Hertz for 30 seconds, and my original flame graph implementation:

Click here to view code image


# git clone https://github.com/brendangregg/FlameGraph
# cd FlameGraph
# perf record -F 49 -ag -- sleep 30
# perf script --header | ./stackcollapse-perf.pl | ./flamegraph.pl > flame1.svg

The stackcollapse-perf.pl program converts perf script output into a standard format to be read by the flamegraph.pl program. There are converters in the FlameGraph repository for many other profilers. The flamegraph.pl program creates the flame graph as an SVG file with embedded JavaScript for interactivity when loaded in a browser. flamegraph.pl supports many options for customizations: run flamegraph.pl –help for details.

I recommend that you save the output of perf script --header for later analysis. Netflix has developed a newer flame graph implementation using d3, along with an additional tool that can read perf script output, FlameScope, which visualizes profiles as subsecond offset heatmaps from which time ranges can be selected to see the flame graph. [76] [77]

Internals
When perf(1) does timed sampling, it tries to use PMC-based hardware CPU cycle overflow events that trigger a non-maskable interrupt (NMI) to perform the sampling. In the cloud, however, many instance types do not have PMCs enabled. This may be visible in dmesg(1):

Click here to view code image


# dmesg | grep PMU
[    2.827349] Performance Events: unsupported p6 CPU model 85 no PMU driver,
software events only.

On these systems, perf(1) falls back to an hrtimer-based software interrupt. You can see this when running perf with -v:

Click here to view code image


# perf record -F 99 -a -v
Warning:
The cycles event is not supported, trying to fall back to cpu-clock-ticks
[...]

This software interrupt is generally sufficient, although be aware that there are some kernel code paths that it cannot interrupt: those with IRQs disabled (including some code paths in scheduling and hardware events). Your resulting profile will be missing samples from these code paths.

For more about how PMCs work, see Section 2.12 in Chapter 2.

6.2.5 Event Statistics and Tracing
Tools that trace events can also be used for CPU analysis. The traditional Linux tools that do this are perf(1) and Ftrace. These tools can not only trace events and save per-event details but can also count events in kernel context.

perf
perf(1) can instrument tracepoints, kprobes, uprobes, and (as of recently) USDT probes. These can provide some logical context for why CPU resources were consumed.

As an example, consider an issue where system-wide CPU utilization is high, but there is no visible process responsible in top(1). The issue could be short-lived processes. To test this hypothesis, count the sched_process_exec tracepoint system-wide using perf script to show the rate of exec() family syscalls:

Click here to view code image


# perf stat -e sched:sched_process_exec -I 1000
#           time             counts unit events
     1.000258841                169      sched:sched_process_exec
     2.000550707                168      sched:sched_process_exec
     3.000676643                167      sched:sched_process_exec
     4.000880905                167      sched:sched_process_exec
[...]

This output shows that there were over 160 execs per second. You can record each event using perf record, then dump the events using perf script2:

2 In case anyone is wondering why I don’t use strace(1) for this. The current implementation of strace(1) uses breakpoints that can greatly slow the target (over 100x), making it dangerous for production use. More than one replacement is in development, including the perf trace subcommand, and another that is BPF based. Also, this example traces the exec() syscall system-wide, which strace(1) currently cannot do.

Click here to view code image


# perf record -e sched:sched_process_exec -a
^C[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 3.464 MB perf.data (95 samples) ]
# perf script
    make 28767 [007] 712132.535241: sched:sched_process_exec: filename=/usr/bin/make
pid=28767 old_pid=28767
      sh 28768 [004] 712132.537036: sched:sched_process_exec: filename=/bin/sh
pid=28768 old_pid=28768
   cmake 28769 [007] 712132.538138: sched:sched_process_exec: filename=/usr/bin/cmake
pid=28769 old_pid=28769
    make 28770 [001] 712132.548034: sched:sched_process_exec: filename=/usr/bin/make
pid=28770 old_pid=28770
      sh 28771 [004] 712132.550399: sched:sched_process_exec: filename=/bin/sh
pid=28771 old_pid=28771
[...]

The output shows that the processes executed had names including make, sh, and cmake, which leads me to suspect that a software build is the culprit. Short-lived processes are such a common issue that there is a dedicated BPF tool for it: execsnoop(8). The fields in this output are: process name, PID, [CPU], timestamp (seconds), event name, and event arguments .

perf(1) has a special subcommand for CPU scheduler analysis called perf sched. It uses a dump-and-post-process approach for analyzing scheduler behavior and provides various reports that can show the CPU runtime per wakeup, the average and maximum scheduler latency (delay), and ASCII visualizations to show thread execution per CPU and migrations. Some example output:

Click here to view code image


# perf sched record -- sleep 1
[ perf record: Woken up 1 times to write data ]
[ perf record: Captured and wrote 1.886 MB perf.data (13502 samples) ]
# perf sched timehist
Samples do not have callchains.
           time    cpu  task name               wait time  sch delay   run time
                        [tid/pid]                  (msec)     (msec)     (msec)
--------------- ------  ----------------------  ---------  ---------  ---------
[...]
  991963.885740 [0001]  :17008[17008]              25.613      0.000      0.057
  991963.886009 [0001]  sleep[16999]             1000.104      0.006      0.269
  991963.886018 [0005]  cc1[17083]                 19.908      0.000      9.948
[...]

The output is verbose, showing all scheduler context switch events as a line summary with the time sleeping (wait time), scheduler latency (sch delay), and time spent on CPU (runtime), all in milliseconds. This output shows a sleep(1) command that slept for 1 second, and a cc1 process that ran for 9.9 milliseconds and slept for 19.9 milliseconds.

The perf sched subcommand can help solve many types of scheduler issues, including problems with the kernel scheduler implementation (the kernel scheduler is complex code that balances many requirements). However, the dump-and-post-process style is costly: This example recorded scheduler events for 1 second on an eight-CPU system, resulting in a 1.9 Mbyte perf.data file. On a larger, busier system, and for a longer duration, that file could be hundreds of Mbytes, which can become a problem with the CPU time needed to generate the file and the file system I/O to write it to disk.

To make sense of so many scheduler events, perf(1) output is often visualized. perf(1) also has a timechart subcommand for its own visualization.

Where possible, I recommend using BPF instead of perf sched as it can do in-kernel summaries that answer similar questions and emit the results (for example, the runqlat(8) and runqlen(8) tools, covered in Sections 6.3.3 and 6.3.4).

Ftrace
Ftrace is a collection of different tracing capabilities, developed by Steven Rostedt and first added to Linux 2.6.27 (2008). As with perf(1), it can also be used to explore the context of CPU usage via tracepoints and other events.

As an example, my perf-tools collection [78] mostly uses Ftrace for instrumentation, and includes funccount(8) for counting functions. This example counts the ext4 file system calls by matching those that begin with “ext”:

Click here to view code image


# perf-tools/bin/funccount 'ext*'
Tracing "ext*"... Ctrl-C to end.
^C
FUNC                              COUNT
[...]
ext4_do_update_inode                523
ext4_inode_csum.isra.56             523
ext4_inode_csum_set                 523
ext4_mark_iloc_dirty                523
ext4_reserve_inode_write            523
ext4_inode_table                    551
ext4_get_group_desc                 564
ext4_nonda_switch                   586
ext4_bio_write_page                 604
ext4_journal_check_start           1001
ext4_es_can_be_merged              1111
ext4_file_getattr                  7159
ext4_getattr                       7285

The output here has been truncated to show only the most frequently used functions. The most frequent was ext4_getattr(), with 7285 calls while tracing.

Function calls consume CPU, and their names often provide clues as to the workload performed. In cases where the function name is ambiguous, it is often possible to find the source code to the function online and read it to understand what it does. This is especially true of Linux kernel functions, which are open source.

Ftrace has many useful canned capabilities, and recent enhancements have added histograms and more frequency counts (“hist triggers”). Unlike BPF, it is not fully programmable, so it cannot be used to fetch data and present it in completely custom ways.

6.3 BPF TOOLS
This section covers the BPF tools you can use for CPU performance analysis and troubleshooting. They are shown in Figure 6-4 and listed in Table 6-3.


Figure 6-4 BPF tools for CPU analysis

These tools are either from the BCC and bpftrace repositories covered in Chapters 4 and 5, or were created for this book. Some tools appear in both BCC and bpftrace. Table 6-3 lists the origins of the tools covered in this section (BT is short for bpftrace.)

Table 6-3 CPU-Related Tools

Tool

Source

Target

Description

execsnoop

BCC/BT

Sched

Lists new process execution

exitsnoop

BCC

Sched

Shows process lifespan and exit reason

runqlat

BCC/BT

Sched

Summarizes CPU run queue latency

runqlen

BCC/BT

Sched

Summarizes CPU run queue length

runqslower

BCC

Sched

Prints run queue waits slower than a threshold

cpudist

BCC

Sched

Summarizes on-CPU time

cpufreq

Book

CPUs

Samples CPU frequency by process

profile

BCC

CPUs

Samples CPU stack traces

offcputime

BCC/book

Sched

Summarizes off-CPU stack traces and times

syscount

BCC/BT

Syscalls

Counts system calls by type and process

argdist

BCC

Syscalls

Can be used for syscall analysis

trace

BCC

Syscalls

Can be used for syscall analysis

funccount

BCC

Software

Counts function calls

softirqs

BCC

Interrupts

Summarizes soft interrupt time

hardirqs

BCC

Interrupts

Summarizes hard interrupt time

smpcalls

Book

Kernel

Times SMP remote CPU calls

llcstat

BCC

PMCs

Summarizes LLC hit ratio by process

For the tools from BCC and bpftrace, see their repositories for full and updated lists of tool options and capabilities. A selection of the most important capabilities are summarized here.

6.3.1 execsnoop
execsnoop(8)3 is a BCC and bpftrace tool that traces new process execution system-wide. It can find issues of short-lived processes that consume CPU resources and can also be used to debug software execution, including application start scripts.

3 Origin: I created the first execsnoop using DTrace on 24-Mar-2004, to solve a common performance problem I was seeing with short-lived processes in Solaris environments. My prior analysis technique was to enable process accounting or BSM auditing and pick the exec events out of the logs, but both of these came with caveats: Process accounting truncated the process name and arguments to only eight characters. By comparison, my execsnoop tool could be run on a system immediately, without needing special audit modes, and could show much more of the command string. execsnoop is installed by default on OS X, and some Solaris and BSD versions. I also developed the BCC version on 7-Feb-2016, and the bpftrace version on 15-Nov-2017, and for that I added the join() built-in to bpftrace.

Example output from the BCC version:

Click here to view code image


# execsnoop
PCOMM            PID    PPID   RET ARGS
sshd             33096  2366     0 /usr/sbin/sshd -D -R
bash             33118  33096    0 /bin/bash
groups           33121  33119    0 /usr/bin/groups
ls               33123  33122    0 /bin/ls /etc/bash_completion.d
lesspipe         33125  33124    0 /usr/bin/lesspipe
basename         33126  33125    0 /usr/bin/basename /usr/bin/lesspipe
dirname          33129  33128    0 /usr/bin/dirname /usr/bin/lesspipe
tput             33130  33118    0 /usr/bin/tput setaf 1
dircolors        33132  33131    0 /usr/bin/dircolors -b
ls               33134  33133    0 /bin/ls /etc/bash_completion.d
mesg             33135  33118    0 /usr/bin/mesg n
sleep            33136  2015     0 /bin/sleep 30
sh               33143  33139    0 /bin/sh -c command -v debian-sa1 > /dev/null &&...
debian-sa1       33144  33143    0 /usr/lib/sysstat/debian-sa1 1 1
sa1              33144  33143    0 /usr/lib/sysstat/sa1 1 1
sadc             33144  33143    0 /usr/lib/sysstat/sadc -F -L -S DISK 1 1 /var/lo...
sleep            33148  2015     0 /bin/sleep 30
[...]

This tool captured the moment that a user logged into the system using SSH and the processes launched, including sshd(8), groups(1), and mesg(1). It also shows processes from the system activity recorder, sar, writing metrics to its log, including sa1(8) and sadc(8).

Use execsnoop(8) to look for high rates of short-lived processes that are consuming resources. They can be hard to spot as they may be very short-lived and may vanish before tools like top(1) or monitoring agents have a chance to see them. Chapter 1 shows an example of this, where a start script was failing to launch an application in a loop, perturbing the performance on the system. It was easily discovered using execsnoop(8). execsnoop(8) has been used to debug many production issues: perturbations from background jobs, slow or failing application startup, slow or failing container startup, and so on.

execsnoop(8) traces the execve(2) system call (the commonly used exec(2) variant) and shows details of the execve(2) arguments and return value. This catches new processes that follow the fork(2)/clone(2)->exec(2) sequence, as well as processes that re-exec(2) themselves. Some applications create new processes without calling exec(2), for example, when creating a pool of worker processes using fork(2) or clone(2) alone. These are not included in the execsnoop(8) output since they do not call execve(2). This situation should be uncommon: Applications should be creating pools of worker threads, not processes.

Since the rate of process execution is expected to be relatively low (<1000/second), the overhead of this tool is expected to be negligible.

BCC
The BCC version supports various options, including:

-x: Includes failed exec()s

-n pattern: Prints only commands containing patterns

-l pattern: Prints only commands where arguments contain patterns

--max-args args: Specifies the maximum number of arguments to print (with a default of 20)

bpftrace
The following is the code for the bpftrace version of execsnoop(8), which summarizes its core functionality. This version prints basic columns and does not support options:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("%-10s %-5s %s\n", "TIME(ms)", "PID", "ARGS");
}

tracepoint:syscalls:sys_enter_execve
{
        printf("%-10u %-5d ", elapsed / 1000000, pid);
        join(args->argv);
}

BEGIN prints a header. To capture exec() events, the syscalls:sys_enter_execve tracepoint is instrumented to print a time since the program began running, the process ID, and the command name and arguments. It uses the join() function on the args->argv field from the tracepoint so that the command name and arguments can be printed on one line.

A future version of bpftrace may change join() to return a string rather than print it out,4 which would make this code:

4 See bpftrace issue #26 [67].

Click here to view code image


tracepoint:syscalls:sys_enter_execve
{
        printf("%-10u %-5d %s\n", elapsed / 1000000, pid, join(args->argv));
}

The BCC version instruments both the entry and the return of the execve() syscall so that the return value can be printed. The bpftrace program could be easily enhanced to do this as well.5

5 This and later bpftrace programs can easily be enhanced to show more and more details. I’ve resisted doing so here to keep them short and to the point, as well as more easily understood.

See Chapter 13 for a similar tool, threadsnoop(8), which traces the creation of threads rather than process execution.

6.3.2 exitsnoop
exitsnoop(8)6 is a BCC tool that traces when processes exit, showing their age and exit reason. The age is the time from process creation to termination, and includes time both on and off CPU. Like execsnoop(8), exitsnoop(8) can help debug issues of short-lived processes, providing different information to help understand this type of workload. For example:

6 Origin: This was created by Arturo Martin-de-Nicolas on 4-May-2019.

Click here to view code image


# exitsnoop
PCOMM            PID    PPID   TID    AGE(s)  EXIT_CODE
cmake            8994   8993   8994   0.01    0
sh               8993   8951   8993   0.01    0
sleep            8946   7866   8946   1.00    0
cmake            8997   8996   8997   0.01    0
sh               8996   8995   8996   0.01    0
make             8995   8951   8995   0.02    0
cmake            9000   8999   9000   0.02    0
sh               8999   8998   8999   0.02    0
git              9003   9002   9003   0.00    0
DOM Worker       5111   4183   8301   221.25  0
sleep            8967   26663  8967   7.31    signal 9 (KILL)
git              9004   9002   9004   0.00    0
[...]

This output shows many short-lived processes exiting, such as cmake(1), sh(1), and make(1): a software build was running. A sleep(1) process exited successfully (exit code 0) after 1.00 seconds, and another sleep(1) process exited after 7.31 seconds due to a KILL signal. This also caught a “DOM Worker” thread exiting after 221.25 seconds.

This tool works by instrumenting the sched:sched_process_exit tracepoint and its arguments, and it also uses bpf_get_current_task() so that the start time can be read from the task struct (an unstable interface detail). Since this tracepoint should fire infrequently, the overhead of this tool should be negligible.

Command line usage:

Click here to view code image


exitsnoop [options]

Options include:

-p PID: Measures this process only

-t: Includes timestamps

-x: Only trace fails (a non-zero exit reason)

There is not currently a bpftrace version of exitsnoop(8), but it might be a useful exercise to create one for those learning bpftrace programming.7

7 If you publish it, remember to credit the original BCC author: Arturo Martin-de-Nicolas.

6.3.3 runqlat
runqlat(8)8 is a BCC and bpftrace tool for measuring CPU scheduler latency, often called run queue latency (even when no longer implemented using run queues). It is useful for identifying and quantifying issues of CPU saturation, where there is more demand for CPU resources than they can service. The metric measured by runqlat(8) is the time each thread (task) spends waiting for its turn on CPU.

8 Origin: I created the first version using DTrace as dispqlat.d, published on 13-Aug-2012, inspired by the DTrace sched provider probes and examples in the “Dynamic Tracing Guide,” Jan 2005 [Sun 05]. dispq is short for dispatcher queue, another term for run queue. I developed the BCC runqlat version on 7-Feb-2016, and bpftrace on 17-Sep-2018.

The following shows BCC runqlat(8) running on a 48-CPU production API instance operating at about 42% CPU utilization system-wide. The arguments to runqlat(8) are “10 1” to set a 10-second interval and output only once:

Click here to view code image


# runqlat 10 1
Tracing run queue latency... Hit Ctrl-C to end.

     usecs               : count     distribution
         0 -> 1          : 3149     |                                        |
         2 -> 3          : 304613   |****************************************|
         4 -> 7          : 274541   |************************************    |
         8 -> 15         : 58576    |*******                                 |
        16 -> 31         : 15485    |**                                      |
        32 -> 63         : 24877    |***                                     |
        64 -> 127        : 6727     |                                        |
       128 -> 255        : 1214     |                                        |
       256 -> 511        : 606      |                                        |
       512 -> 1023       : 489      |                                        |
      1024 -> 2047       : 315      |                                        |
      2048 -> 4095       : 122      |                                        |
      4096 -> 8191       : 24       |                                        |
      8192 -> 16383      : 2        |                                        |

This output shows that, most of the time, threads were waiting less than 15 microseconds, with a mode in the histogram between two and 15 microseconds. This is relatively fast—an example of a healthy system—and is expected for a system running at 42% CPU utilization. Occasionally run queue latency reached as high as the eight- to 16-millisecond bucket in this example, but those were outliers.

runqlat(8) works by instrumenting scheduler wakeup and context switch events to determine the time from wakeup to running. These events can be very frequent on busy production systems, exceeding one million events per second. Even though BPF is optimized, at these rates even adding one microsecond per event can cause noticeable overhead.9 Use with caution.

9 As a simple exercise, if you had a context switch rate of 1M/sec across a 10-CPU system, adding 1 microsecond per context switch would consume 10% of CPU resources (100% × (1 × 1000000 / 10 × 1000000)). See Chapter 18 for some real measurements of BPF overhead, which is typically much less than one microsecond per event.

Misconfigured Build
Here is a different example for comparison. This time a 36-CPU build server is doing a software build, where the number of parallel jobs has been set to 72 by mistake, causing the CPUs to be overloaded:

Click here to view code image


# runqlat 10 1
Tracing run queue latency... Hit Ctrl-C to end.

     usecs               : count     distribution
         0 -> 1          : 1906     |***                                     |
         2 -> 3          : 22087    |****************************************|
         4 -> 7          : 21245    |**************************************  |
         8 -> 15         : 7333     |*************                           |
        16 -> 31         : 4902     |********                                |
        32 -> 63         : 6002     |**********                              |
        64 -> 127        : 7370     |*************                           |
       128 -> 255        : 13001    |***********************                 |
       256 -> 511        : 4823     |********                                |
       512 -> 1023       : 1519     |**                                      |
      1024 -> 2047       : 3682     |******                                  |
      2048 -> 4095       : 3170     |*****                                   |
      4096 -> 8191       : 5759     |**********                              |
      8192 -> 16383      : 14549    |**************************              |
     16384 -> 32767      : 5589     |**********                              |
     32768 -> 65535      : 372      |                                        |
     65536 -> 131071     : 10       |                                        |

The distribution is now tri-modal, with the slowest mode centered in the 8- to 16-millisecond bucket. This shows significant waiting by threads.

This particular issue is straightforward to identify from other tools and metrics. For example, sar(1) can show CPU utilization (-u) and run queue metrics (-q):

Click here to view code image


# sar -uq 1
Linux 4.18.0-virtual (...)   01/21/2019    _x86_64_      (36 CPU)

11:06:25 PM     CPU     %user     %nice   %system   %iowait    %steal     %idle
11:06:26 PM     all     88.06      0.00     11.94      0.00      0.00      0.00

11:06:25 PM   runq-sz  plist-sz   ldavg-1   ldavg-5  ldavg-15   blocked
11:06:26 PM        72      1030     65.90     41.52     34.75         0
[...]

This sar(1) output shows 0% CPU idle and an average run queue size of 72 (which includes both running and runnable)—more than the 36 CPUs available.

Chapter 15 has a runqlat(8) example showing per-container latency.

BCC
Command line usage for the BCC version:

Click here to view code image


runqlat [options] [interval [count]]

Options include:

-m: Prints output in milliseconds

-P: Prints a histogram per process ID

--pidnss: Prints a histogram per PID namespace

-p PID: Traces this process ID only

-T: Includes timestamps on output

The -T option is useful for annotating per-interval output with the time. For example, runqlat -T 1 for timestamped per-second output.

bpftrace
The following is the code for the bpftrace version of runqlat(8), which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/sched.h>

BEGIN
{
        printf("Tracing CPU scheduler... Hit Ctrl-C to end.\n");
}

tracepoint:sched:sched_wakeup,
tracepoint:sched:sched_wakeup_new
{
        @qtime[args->pid] = nsecs;
}

tracepoint:sched:sched_switch
{
        if (args->prev_state == TASK_RUNNING) {
                @qtime[args->prev_pid] = nsecs;
        }

        $ns = @qtime[args->next_pid];
        if ($ns) {
                @usecs = hist((nsecs - $ns) / 1000);
        }
        delete(@qtime[args->next_pid]);
}

END
{
        clear(@qtime);
}

The program records a timestamp on the sched_wakeup and sched_wakeup_new tracepoints, keyed by args->pid, which is the kernel thread ID.

The sched_switch action stores a timestamp on args->prev_pid if that state was still runnable (TASK_RUNNING). This is handling an involuntary context switch where, the moment the thread leaves the CPU, it is returned to a run queue. That action also checks whether a timestamp was stored for the next runnable process and, if so, calculates the time delta and stores it in the @usecs histogram.

Since TASK_RUNNING was used, the linux/sched.h header file was read (#include) so that its definition was available.

The BCC version can break down by PID, which this bpftrace version can easily be modified to do by adding a pid key to the @usecs map. Another enhancement in BCC is to skip recording run queue latency for PID 0 to exclude the latency of scheduling the kernel idle thread.10 Again, this program can easily be modified to do the same.

10 Thanks, Ivan Babrou, for adding that.

6.3.4 runqlen
runqlen(8)11 is a BCC and bpftrace tool for sampling the length of the CPU run queues, counting how many tasks are waiting their turn, and presenting this as a linear histogram. This can be used to further characterize issues of run queue latency or as a cheaper approximation.

11 Origin: I created the first version, called dispqlen.d, on 27-Jun-2005, to help characterize run queue lengths by CPU. I developed the BCC version on 12-Dec-2016 and the bpftrace version on 7-Oct-2018.

The following shows runqlet(8) from BCC running on a 48-CPU production API instance that is at about 42% CPU utilization system-wide (the same instance shown earlier with runqlat(8)). The arguments to runqlen(8) are “10 1” to set a 10-second interval and output only once:

Click here to view code image


# runqlen 10 1
Sampling run queue length... Hit Ctrl-C to end.

     runqlen       : count     distribution
        0          : 47284    |****************************************|
        1          : 211      |                                        |
        2          : 28       |                                        |
        3          : 6        |                                        |
        4          : 4        |                                        |
        5          : 1        |                                        |
        6          : 1        |                                        |

This shows that most of the time, the run queue length was zero, meaning that threads did not need to wait their turn.

I describe run queue length as a secondary performance metric and run queue latency as primary. Unlike length, latency directly and proportionately affects performance. Imagine joining a checkout line at a grocery store. What matters more to you: the length of the line or the time you actually spend waiting? runqlat(8) matters more. So why use runqlen(8)?

First, runqlen(8) can be used to further characterize issues found in runqlat(8) and explain how latencies become high. Second, runqlen(8) employs timed sampling at 99 Hertz, whereas runqlat(8) traces scheduler events. This timed sampling has negligible overhead compared to runqlat(8)’s scheduler tracing. For 24x7 monitoring, it may be preferable to use runqlen(8) first to identify issues (since it is cheaper to run) and then use runqlat(8) ad hoc to quantify the latency.

Four Threads, One CPU
In this example, a CPU workload of four busy threads was bound to CPU 0. runqlen(8) was executed with -C to show per-CPU histograms:

Click here to view code image


# runqlen -C
Sampling run queue length... Hit Ctrl-C to end.
^C

cpu = 0
     runqlen       : count     distribution
        0          : 0        |                                        |
        1          : 0        |                                        |
        2          : 0        |                                        |
        3          : 551      |****************************************|

cpu = 1
     runqlen       : count     distribution
        0          : 41       |****************************************|

cpu = 2
     runqlen       : count     distribution
        0          : 126      |****************************************|
[...]

The run queue length on CPU 0 was three: one thread on-CPU and three threads waiting. This per-CPU output is useful for checking scheduler balance.

BCC
Command line usage for the BCC version:

Click here to view code image


runqlen [options] [interval [count]]

Options include:

-C: Prints a histogram per CPU

-O: Prints run queue occupancy

-T: Includes timestamps on output

Run queue occupancy is a separate metric that shows the percentage of time that there were threads waiting. This is sometimes useful when a single metric is needed for monitoring, alerting, and graphing.

bpftrace
The following is the code for the bpftrace version of runqlen(8), which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/sched.h>

struct cfs_rq_partial {
        struct load_weight load;
        unsigned long runnable_weight;
        unsigned int nr_running;
};

BEGIN
{
        printf("Sampling run queue length at 99 Hertz... Hit Ctrl-C to end.\n");
}

profile:hz:99
{
        $task = (struct task_struct *)curtask;
        $my_q = (struct cfs_rq_partial *)$task->se.cfs_rq;
        $len = $my_q->nr_running;
        $len = $len > 0 ? $len - 1 : 0;        // subtract currently running task
        @runqlen = lhist($len, 0, 100, 1);
}

The program needs to reference the nr_running member of the cfs_rq struct, but this struct is not available in the standard kernel headers. So the program begins by defining a cfs_rq_partial struct, enough to fetch the needed member. This workaround may no longer be needed once BTF is available (see Chapter 2).

The main event is the profile:hz:99 probe, which samples the run queue length at 99 Hertz on all CPUs. The length is fetched by walking from the current task struct to the run queue it is on and then reading the length of the run queue. These struct and member names may need to be adjusted if the kernel source changes.

You can have this bpftrace version break down by CPU by adding a cpu key to @runqlen.

6.3.5 runqslower
runqslower(8)12 is a BCC tool that lists instances of run queue latency exceeding a configurable threshold and shows the process that suffered the latency and its duration. The following example is from a 48-CPU production API instance currently running at 45% CPU utilization system-wide:

12 Origin: This was created by Ivan Babrou on 2-May-2018.

Click here to view code image


# runqslower
Tracing run queue latency higher than 10000 us
TIME     COMM             PID           LAT(us)
17:42:49 python3          4590            16345
17:42:50 pool-25-thread-  4683            50001
17:42:53 ForkJoinPool.co  5898            11935
17:42:56 python3          4590            10191
17:42:56 ForkJoinPool.co  5912            13738
17:42:56 ForkJoinPool.co  5908            11434
17:42:57 ForkJoinPool.co  5890            11436
17:43:00 ForkJoinPool.co  5477            10502
17:43:01 grpc-default-wo  5794            11637
17:43:02 tomcat-exec-296  6373            12083
[...]

This output shows that over a period of 13 seconds, there were 10 cases of run queue latency exceeding the default threshold of 10000 microseconds (10 milliseconds). This might seem surprising for a server with 55% idle CPU headroom, but this is a busy multi-threaded application, and some run queue imbalance is likely until the scheduler can migrate threads to idle CPUs. This tool can confirm the affected applications.

This tool currently works by using kprobes for the kernel functions ttwu_do_wakeup(), wake_up_new_task(), and finish_task_switch(). A future version should switch to scheduler tracepoints, using code similar to the earlier bpftrace version of runqlat(8). The overhead is similar to that of runqlat(8); it can cause noticeable overhead on busy systems due to the cost of the kprobes, even while runqslower(8) is not printing any output.

Command line usage:

Click here to view code image


runqslower [options] [min_us]

Options include:

-p PID: Measures this process only

The default threshold is 10000 microseconds.

6.3.6 cpudist
cpudist(8)13 is a BCC tool for showing the distribution of on-CPU time for each thread wakeup. This can be used to help characterize CPU workloads, providing details for later tuning and design decisions. For example, from a 48-CPU production instance:

13 Origin: I created cpudists on 27-Apr-2005, showing CPU runtime distributions for processes, the kernel, and the idle thread. Sasha Goldshtein developed the BCC cpudist(8) on 29-Jun-2016, with options for per-process distributions.

Click here to view code image


# cpudist 10 1
Tracing on-CPU time... Hit Ctrl-C to end.

     usecs               : count     distribution
         0 -> 1          : 103865   |***************************             |
         2 -> 3          : 91142    |************************                |
         4 -> 7          : 134188   |***********************************     |
         8 -> 15         : 149862   |****************************************|
        16 -> 31         : 122285   |********************************        |
        32 -> 63         : 71912    |*******************                     |
        64 -> 127        : 27103    |*******                                 |
       128 -> 255        : 4835     |*                                       |
       256 -> 511        : 692      |                                        |
       512 -> 1023       : 320      |                                        |
      1024 -> 2047       : 328      |                                        |
      2048 -> 4095       : 412      |                                        |
      4096 -> 8191       : 356      |                                        |
      8192 -> 16383      : 69       |                                        |
     16384 -> 32767      : 42       |                                        |
     32768 -> 65535      : 30       |                                        |
     65536 -> 131071     : 22       |                                        |
    131072 -> 262143     : 20       |                                        |
    262144 -> 524287     : 4        |                                        |

This output shows that the production application usually spends only a short amount of time on CPU: from 0 to 127 microseconds.

Here is a CPU-heavy workload, with more busy threads than CPUs available, and with a histogram in milliseconds (-m):

Click here to view code image


# cpudist -m
Tracing on-CPU time... Hit Ctrl-C to end.
^C
     msecs               : count     distribution
         0 -> 1          : 521      |****************************************|
         2 -> 3          : 60       |****                                    |
         4 -> 7          : 272      |********************                    |
         8 -> 15         : 308      |***********************                 |
        16 -> 31         : 66       |*****                                   |
        32 -> 63         : 14       |*                                       |

Now there is a mode of on-CPU durations from 4 to 15 milliseconds: this is likely threads exhausting their scheduler time quanta and then encountering an involuntary context switch.

This tool was used to help understand a Netflix production change, where a machine learning application began running three times faster. The perf(1) command was used to show that the context switch rate had dropped, and cpudist(8) was used to explain the affect this had: the application was now usually running for two to four milliseconds between context switches, whereas earlier it could only run for between zero and three microseconds before being interrupted with a context switch.

cpudist(8) works by tracing scheduler context switch events, which can be very frequent on busy production workloads (over one million events/sec). As with runqlat(8), the overhead of this tool could be significant, so use it with caution.

Command line usage:

Click here to view code image


cpudist [options] [interval [count]]

Options include:

-m: Prints output in milliseconds (default is microseconds)

-O: Shows off-CPU time instead of on-CPU time

-P: Prints a histogram per process

-p PID: Measures this process only

There is currently no bpftrace version of cpudist(8). I’ve resisted creating one and instead have added it as an optional exercise at the end of this chapter.

6.3.7 cpufreq
cpufreq(8)14 samples the CPU frequency and shows it as a system-wide histogram, with per-process name histograms. This only works for CPU scaling governors that change the frequency, such as powersave, and can be used to determine the clock speed at which your applications are running. For example:

14 Origin: I created it for this book on 24-Apr-2019, inspired by the time_in_state BPF tool from Android by Connor O'Brien, with some initial work by Joel Fernandes; it uses sched tracepoints to track the frequency more precisely.

Click here to view code image


# cpufreq.bt
Sampling CPU freq system-wide & by process. Ctrl-C to end.
^C
[...]

@process_mhz[snmpd]:
[1200, 1400)           1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@process_mhz[python3]:
[1600, 1800)           1 |@                                                   |
[1800, 2000)           0 |                                                    |
[2000, 2200)           0 |                                                    |
[2200, 2400)           0 |                                                    |
[2400, 2600)           0 |                                                    |
[2600, 2800)           2 |@@@                                                 |
[2800, 3000)           0 |                                                    |
[3000, 3200)          29 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@process_mhz[java]:
[1200, 1400)         216 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1400, 1600)          23 |@@@@@                                               |
[1600, 1800)          18 |@@@@                                                |
[1800, 2000)          16 |@@@                                                 |
[2000, 2200)          12 |@@                                                  |
[2200, 2400)           0 |                                                    |
[2400, 2600)           4 |                                                    |
[2600, 2800)           2 |                                                    |
[2800, 3000)           1 |                                                    |
[3000, 3200)          18 |@@@@                                                |


@system_mhz:
[1200, 1400)       22041 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1400, 1600)         903 |@@                                                  |
[1600, 1800)         474 |@                                                   |
[1800, 2000)         368 |                                                    |
[2000, 2200)          30 |                                                    |
[2200, 2400)           3 |                                                    |
[2400, 2600)          21 |                                                    |
[2600, 2800)          33 |                                                    |
[2800, 3000)          15 |                                                    |
[3000, 3200)         270 |                                                    |
[...]

This shows that, system-wide, the CPU frequency was usually in the 1200 to 1400 MHz range, so this is a mostly idle system. Similar frequencies were encountered by the java process, with only some samples (18 while sampling) reaching the 3.0 to 3.2 GHz range. This application was mostly doing disk I/O, causing the CPUs to enter a power saving state. python3 processes were usually running at full speed.

This tool works by tracing frequency change tracepoints to determine the speed of each CPU, and then samples that speed at 100 Hertz. The performance overhead should be low to negligible. The previous output is from a system using the powersave scaling governor, as set in /sys/devices/system/cpu/cpufreq/.../scaling_governor. When the system is set to the performance governor, this tool shows nothing as there are no more frequency changes to instrument: the CPUs are pinned at the highest frequency.

Here is an excerpt from a production workload I just discovered:

Click here to view code image


@process_mhz[nginx]:
[1200, 1400)          35 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                |
[1400, 1600)          17 |@@@@@@@@@@@@@@@@@                                   |
[1600, 1800)          16 |@@@@@@@@@@@@@@@@                                    |
[1800, 2000)          17 |@@@@@@@@@@@@@@@@@                                   |
[2000, 2200)           0 |                                                    |
[2200, 2400)           0 |                                                    |
[2400, 2600)           0 |                                                    |
[2600, 2800)           0 |                                                    |
[2800, 3000)           0 |                                                    |
[3000, 3200)           0 |                                                    |
[3200, 3400)           0 |                                                    |
[3400, 3600)           0 |                                                    |
[3600, 3800)          50 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

It shows that the production application, nginx, was often running at low CPU clock frequencies. The CPU scaling_governor had not been set to performance and had defaulted to powersave.

The source for cpufreq(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Sampling CPU freq system-wide & by process. Ctrl-C to end.\n");
}

tracepoint:power:cpu_frequency
{
        @curfreq[cpu] = args->state;
}
profile:hz:100
/@curfreq[cpu]/
{
        @system_mhz = lhist(@curfreq[cpu] / 1000, 0, 5000, 200);
        if (pid) {
                @process_mhz[comm] = lhist(@curfreq[cpu] / 1000, 0, 5000, 200);
        }
}

END
{
        clear(@curfreq);
}

The frequency changes are traced using the power:cpu_frequency tracepoint and saved in a @curfreq BPF map by CPU, for later lookup while sampling. The histograms track frequencies from 0 to 5000 MHz in steps of 200 MHz; these parameters can be adjusted in the tool if needed.

6.3.8 profile
profile(8)15 is a BCC tool that samples stack traces at a timed interval and reports a frequency count of stack traces. This is the most useful tool in BCC for understanding CPU consumption as it summarizes almost all code paths that are consuming CPU resources. (See the hardirqs(8) tool in Section 6.3.14 for more CPU consumers.) It can also be used with relatively negligible overhead, as the event rate is fixed to the sample rate, which can be tuned.

15 Origin: there have been many profilers in the past, including gprof from 1982 [Graham 82] (rewritten in 1988 by Jay Fenlason for the GNU project). I developed this version for BCC on 15-Jul-2016, based on code from Sasha Goldshtein, Andrew Birchall, Evgeny Vereshchagin, and Teng Qin. My first version predated kernel support and worked by using a hack: I added a tracepoint on perf samples, to be used in conjunction with perf_event_open(). My patch to add this tracepoint to Linux was rejected by Peter Zijistra, in favor of developing proper profiling support with BPF, which Alexei Starovoitov added.

By default, this tool samples both user and kernel stack traces at 49 Hertz across all CPUs. This can be customized using options, and the settings are printed at the start of the output. For example:

Click here to view code image


# profile
Sampling at 49 Hertz of all threads by user + kernel stack... Hit Ctrl-C to end.
^C

    sk_stream_alloc_skb
    sk_stream_alloc_skb
    tcp_sendmsg_locked
    tcp_sendmsg
    sock_sendmsg
    sock_write_iter
    __vfs_write
    vfs_write
    ksys_write
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    __GI___write
    [unknown]
    -                iperf (29136)
        1

[...]

    __free_pages_ok
    __free_pages_ok
    skb_release_data
    __kfree_skb
    tcp_ack
    tcp_rcv_established
    tcp_v4_do_rcv
    __release_sock
    release_sock
    tcp_sendmsg
    sock_sendmsg
    sock_write_iter
    __vfs_write
    vfs_write
    ksys_write
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    __GI___write
    [unknown]
    -                iperf (29136)
        1889

    get_page_from_freelist
    get_page_from_freelist
    __alloc_pages_nodemask
    skb_page_frag_refill
    sk_page_frag_refill
    tcp_sendmsg_locked
    tcp_sendmsg
    sock_sendmsg
    sock_write_iter
    __vfs_write
    vfs_write
    ksys_write
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    __GI___write
    [unknown]
    -                iperf (29136)
        2673

The output shows the stack traces as a list of functions, followed by a dash (“-”) and the process name and PID in parentheses, and finally a count for that stack trace. The stack traces are printed in frequency count order, from least to most frequent.

The full output in this example was 17,254 lines long and has been truncated here to show only the first and final two stack traces. The most frequent stack trace, showing a path through vfs_write() and ending with get_page_from_freelist() on CPU, was seen 2673 times while sampling.

CPU Flame Graphs
Flame graphs are visualizations of stack traces that can help you quickly understand profile(8) output. They were introduced in Chapter 2.

To support flame graphs, profile(8) can produce output in folded format using -f: Stack traces are printed on one line, with functions separated by semicolons. For example, writing a 30-second profile to an out.stacks01 file and including kernel annotations (-a):

Click here to view code image


# profile -af 30 > out.stacks01
# tail -3 out.stacks01
iperf;
[unknown];__GI___write;entry_SYSCALL_64_after_hwframe_[k];do_syscall_64_[k];ksys_writ
e_[k];vfs_write_[k];__vfs_write_[k];sock_write_iter_[k];sock_sendmsg_[k];tcp_sendmsg_
[k];tcp_sendmsg_locked_[k];_copy_from_iter_full_[k];copyin_[k];copy_user_enhanced_fas
t_string_[k];copy_user_enhanced_fast_string_[k] 5844
iperf;
[unknown];__GI___write;entry_SYSCALL_64_after_hwframe_[k];do_syscall_64_[k];ksys_writ
e_[k];vfs_write_[k];__vfs_write_[k];sock_write_iter_[k];sock_sendmsg_[k];tcp_sendmsg_
[k];release_sock_[k];__release_sock_[k];tcp_v4_do_rcv_[k];tcp_rcv_established_[k];tcp
_ack_[k];__kfree_skb_[k];skb_release_data_[k];__free_pages_ok_[k];__free_pages_ok_[k]
10713
iperf;
[unknown];__GI___write;entry_SYSCALL_64_after_hwframe_[k];do_syscall_64_[k];ksys_writ
e_[k];vfs_write_[k];__vfs_write_[k];sock_write_iter_[k];sock_sendmsg_[k];tcp_sendmsg_
[k];tcp_sendmsg_locked_[k];sk_page_frag_refill_[k];skb_page_frag_refill_[k];__alloc_p
ages_nodemask_[k];get_page_from_freelist_[k];get_page_from_freelist_[k] 15088

Only the last three lines are shown here. This output can be fed into my original flame graph software to generate a CPU flame graph:

Click here to view code image


$ git clone https://github.com/brendangregg/FlameGraph
$ cd FlameGraph
$ ./flamegraph.pl --color=java < ../out.stacks01 > out.svg

flamegraph.pl supports different color palettes. The java palette used here makes use of the kernel annotations (“_[k]”) for choosing color hues. The generated SVG is shown in Figure 6-5.


Figure 6-5 CPU flame graph from BPF sampled stacks

This flame graph shows that the hottest code paths ended in get_page_from_freelist_() and __free_pages_ok_()—these are the widest towers, with width proportional to their frequency in the profile. In a browser, this SVG supports click-to-zoom so that narrow towers can be expanded and their functions read.

What makes profile(8) different from other CPU profilers is that this frequency count is calculated in kernel space for efficiency. Other kernel-based profilers, such as perf(1), send every sampled stack trace to user space, where it is post-processed into a summary. This can be CPU expensive and, depending on the invocation, it can also involve file system and disk I/O to record the samples. profile(8) avoids those expenses.

Command line usage:

Click here to view code image


profile [options] [-F frequency]

Options include:

-U: Includes user-level stacks only

-K: Includes kernel-level stacks only

-a: Includes frame annotations (e.g., "_[k]" for kernel frames)

-d: Includes delimiters between kernel/user stacks

-f: Provides output in folded format

-p PID: Profiles this process only

bpftrace
The core functionality of profile(8) can be implemented as a bpftrace one-liner:

Click here to view code image


bpftrace -e 'profile:hz:49 /pid/ { @samples[ustack, kstack, comm] = count(); }'

This frequency-counts using the user stack, kernel stack, and process name as the key. A filter on the pid is included to ensure that it is non-zero: this excludes the CPU idle thread stacks. This one-liner can be customized as desired.

6.3.9 offcputime
offcputime(8)16 is a BCC and bpftrace tool to summarize time spent by threads blocked and off CPU, showing stack traces to explain why. For CPU analysis, this tool explains why threads are not running on a CPU. It’s a counterpart to profile(8); between them, they show the entire time spent by threads on the system: on-CPU time with profile(8) and off-CPU time with offcputime(8).

16 Origin: I created off-CPU analysis as a methodology, and DTrace one-liners to apply it, in 2005, after exploring uses of the DTrace sched provider and its sched:::off-cpu probe. When I first explained this to a Sun engineer in Adelaide, he said I should not call it “off-CPU” since the CPU isn’t off! My first off-CPU tools were uoffcpu.d and koffcpu.d in 2010 for my DTrace book [Gregg 11]. For Linux, I published off-CPU analysis using perf(1), with extremely high overhead, on 26-Feb-2015. I finally developed offcputime efficiently using BCC on 13-Jan-2016, and bpftrace for this book on 16-Feb-2019.

The following example shows offcputime(8) from BCC, tracing for five seconds:

Click here to view code image


# offcputime 5
Tracing off-CPU time (us) of all threads by user + kernel stack for 5 secs.

[...]
    finish_task_switch
    schedule
    schedule_timeout
    wait_woken
    sk_stream_wait_memory
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
    __write
    [unknown]
    -                iperf (14657)
        5625

[...]

    finish_task_switch
    schedule
    schedule_timeout
    wait_woken
    sk_wait_data
    tcp_recvmsg
    inet_recvmsg
    sock_recvmsg
    SYSC_recvfrom
    sys_recvfrom
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    recv
    -                iperf (14659)
        1021497

[...]    finish_task_switch
    schedule
    schedule_hrtimeout_range_clock
    schedule_hrtimeout_range
    poll_schedule_timeout
    do_select
    core_sys_select
    sys_select
    do_syscall_64
    entry_SYSCALL_64_after_hwframe
    __libc_select
    [unknown]
    -                offcputime (14667)
        5004039

The output has been truncated to only show three stacks from the hundreds that were printed. Each stack shows the kernel frames (if present), then user-level frames, then the process name and PID, and finally the total time this combination was seen, in microseconds. The first stack shows iperf(1) blocking in sk_stream_wait_memory() for memory, for a total of 5 milliseconds. The second shows iperf(1) waiting for data on a socket via sk_wait_data(), for a total of 1.02 seconds. The last shows the offcputime(8) tool itself waiting in a select(2) syscall for 5.00 seconds; this is likely for the 5-second timeout specified at the command line.

Note that, in all three stacks, the user-level stack traces are incomplete. This is because they ended at libc, and this version does not support the frame pointer. This is more evident in offcputime(8) than profile(8), since blocking stacks often pass through system libraries such as libc or libpthread. See the discussions on broken stack traces and solutions in Chapters 2, 12, 13, and 18, in particular Section 13.2.9.

offcputime(8) has been used to find various production issues, including finding unexpected time blocked in lock acquisition and the stack traces responsible.

offcputime(8) works by instrumenting context switches and recording the time from when a thread leaves the CPU to when it returns, along with the stack trace. The times and stack traces are frequency-counted in kernel context for efficiency. Context switch events can nonetheless be very frequent, and the overhead of this tool can become significant (say, >10%) for busy production workloads. This tool is best run for only short durations to minimize production impact.

Off-CPU Time Flame Graphs
As with profile(8), the output of offcputime(8) can be so verbose that you may find it preferable to examine it as a flame graph, though of a different type than introduced in Chapter 2. Instead of a CPU flame graph, offcputime(8) can be visualized as an off-CPU time flame graph.17

17 These were first published by Yichun Zhang [80].

This example creates an off-CPU time flame graph of kernel stacks for five seconds:

Click here to view code image


# offcputime -fKu 5 > out.offcputime01.txt
$ flamegraph.pl --hash --bgcolors=blue --title="Off-CPU Time Flame Graph" \
    < out.offcputime01.txt > out.offcputime01.svg

I used --bgcolors to change the background color to blue as a visual differentiator from CPU flame graphs. You can also change the frame colors with --colors, and I’ve published many off-CPU flame graphs using a blue palette for the frames18.

18 Nowadays, I prefer to just change the background color to blue, which leaves the frame color to use the same palette as CPU flame graphs for consistency.

These commands produced the flame graph shown in Figure 6-6.


Figure 6-6 Off-CPU time flame graph

This flame graph is dominated by threads sleeping, waiting for work. Applications of interest can be examined by clicking their names to zoom in. For more on off-CPU flame graphs, including examples with full user stack traces, see Chapters 12, 13, and 14.

BCC
Command line usage:

Click here to view code image


offcputime [options] [duration]

Options include:

-f: Prints output in folded format

-p PID: Measures this process only

-u: Traces only user threads

-k: Traces only kernel threads

-U: Shows only user stack traces

-K: Shows only kernel stack traces

Some of these options can help reduce overhead by filtering to record only one PID or stack type.

bpftrace
The following is the code for the bpftrace version of offcputime(8), which summarizes its core functionality. This version supports an optional PID argument for the target to trace:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/sched.h>

BEGIN
{
        printf("Tracing nanosecond time in off-CPU stacks. Ctrl-C to end.\n");
}

kprobe:finish_task_switch
{
        // record previous thread sleep time
        $prev = (struct task_struct *)arg0;
        if ($1 == 0 || $prev->tgid == $1) {
                @start[$prev->pid] = nsecs;
        }

        // get the current thread start time
        $last = @start[tid];
        if ($last != 0) {
                @[kstack, ustack, comm] = sum(nsecs - $last);
                delete(@start[tid]);
        }
}

END
{
        clear(@start);
}

This program records a timestamp for the thread that is leaving the CPU and also sums the off-CPU time for the thread that is starting, in the one finish_task_switch() kprobe.

6.3.10 syscount
syscount(8)19 is a BCC and bpftrace tool for counting system calls system-wide. It is included in this chapter because it can be a starting point for investigating cases of high system CPU time.

19 Origin: I first created this using Ftrace and perf(1) for the perf-tools collection on 7-Jul-2014, and Sasha Goldshtein developed the BCC version on 15-Feb-2017.

The following output shows syscount(8) from BCC printing per-second syscall rates (-i 1) on a production instance:

Click here to view code image


# syscount -i 1
Tracing syscalls, printing top 10... Ctrl+C to quit.
[00:04:18]
SYSCALL                   COUNT
futex                    152923
read                      29973
epoll_wait                27865
write                     21707
epoll_ctl                  4696
poll                       2625
writev                     2460
recvfrom                   1594
close                      1385
sendto                     1343

[...]

This output shows the top 10 syscalls every second, with a timestamp. The most frequent syscall is futex(2), at more than 150,000 calls per second. To further explore each syscall, check the man pages for documentation, and use more BPF tools to trace and inspect their arguments (e.g., BCC trace(8) or bpftrace one-liners). In some situations, running strace(1) can be the quickest path for understanding how a given syscall is used, but keep in mind that the current ptrace-based implementation of strace(1) can slow the target application one hundredfold, which can cause serious issues in many production environments (e.g., exceeding latency SLOs, or triggering failovers). strace(1) should be considered a last resort after you’ve tried BPF tooling.

The -P option can be used to count by process ID instead:

Click here to view code image


# syscount -Pi 1
Tracing syscalls, printing top 10... Ctrl+C to quit.
[00:04:25]
PID    COMM               COUNT
3622   java              294783
990    snmpd                124
2392   redis-server          64
4790   snmp-pass             32
27035  python                31
26970  sshd                  24
2380   svscan                11
2441   atlas-system-ag        5
2453   apache2                2
4786   snmp-pass              1

[...]

The java process is making almost 300,000 syscalls per second. Other tools show that this is consuming only 1.6% system time across this 48-CPU system.

This tool works by instrumenting the raw_syscalls:sys_enter tracepoint rather than the usual syscalls:sys_enter_* tracepoints. The reason is that this is one tracepoint that can see all syscalls, making it quicker to initialize instrumentation. The downside is that it only provides syscall IDs, which must be translated back into the names. BCC provides a library call, syscall_name(), to do this.

The overhead of this tool may become noticeable for very high syscall rates. As an example, I stress-tested one CPU with a syscall rate of 3.2 million syscalls/second/CPU. While running syscount(8), the workload suffered a 30% slowdown. This helps estimate the overhead for production: The 48-CPU instance with a rate of 300,000 syscalls/second is performing about 6000 syscalls/second/CPU, so it would be expected to suffer a 0.06% slowdown (30% × 6250 / 3200000). I tried to measure this directly in production, but it was too small to measure with a variable workload.

BCC
Command line usage:

Click here to view code image


syscount [options] [-i interval] [-d duration]

Options include:

-T TOP: Prints the specified number of top entries

-L: Shows the total time (latency) in syscalls

-P: Counts by process

-p PID: Measures this process only

An example of the -L option is shown in Chapter 13.

bpftrace
There is a bpftrace version of syscount(8) that has the core functionality, but you can also use this one-liner:

Click here to view code image


# bpftrace -e 't:syscalls:sys_enter_* { @[probe] = count(); }'
Attaching 316 probes...
^C

[...]
@[tracepoint:syscalls:sys_enter_ioctl]: 9465
@[tracepoint:syscalls:sys_enter_epoll_wait]: 9807
@[tracepoint:syscalls:sys_enter_gettid]: 10311
@[tracepoint:syscalls:sys_enter_futex]: 14062
@[tracepoint:syscalls:sys_enter_recvmsg]: 22342

In this case, all 316 syscall tracepoints were instrumented (for this kernel version), and a frequency count was performed on the probe name. Currently there is a delay during program startup and shutdown to instrument all 316 tracepoints. It’s preferable to use the single raw_syscalls:sys_enter tracepoint, as BCC does, but that then requires an extra step to translate from syscall ID back to syscall name. This is included as an example in Chapter 14.

6.3.11 argdist and trace
argdist(8) and trace(8) are introduced in Chapter 4, and are BCC tools that can examine events in custom ways. As a follow-on from syscount(8), if a syscall was found to be called frequently, you can use these tools to examine it in more detail.

For example, the read(2) syscall was frequent in the previous syscount(8) output. You can use argdist(8) to summarize its arguments and return value by instrumenting either the syscall tracepoint or its kernel functions. For the tracepoint, you need to find the argument names, which the BCC tool tplist(8) prints out with the -v option:

Click here to view code image


# tplist -v syscalls:sys_enter_read
syscalls:sys_enter_read
    int __syscall_nr;
    unsigned int fd;
    char * buf;
    size_t count;

The count argument is the size of the read(2). Summarizing this using argdist(8) as a histogram (-H):

Click here to view code image


# argdist -H 't:syscalls:sys_enter_read():int:args->count'
[09:08:31]
     args->count         : count     distribution
         0 -> 1          : 169      |*****************                       |
         2 -> 3          : 243      |*************************               |
         4 -> 7          : 1        |                                        |
         8 -> 15         : 0        |                                        |
        16 -> 31         : 384      |****************************************|
        32 -> 63         : 0        |                                        |
        64 -> 127        : 0        |                                        |
       128 -> 255        : 0        |                                        |
       256 -> 511        : 0        |                                        |
       512 -> 1023       : 0        |                                        |
      1024 -> 2047       : 267      |***************************             |
      2048 -> 4095       : 2        |                                        |
      4096 -> 8191       : 23       |**                                      |

[...]

This output shows that there were many reads in the 16- to 31-byte range, as well as the 1024- to 2047-byte range. The -C option to argdist(8) can be used instead of -H to summarize as a frequency count of sizes rather than a histogram.

This is showing the read requested size since the entry to the syscall was instrumented. Compare it with the return value from the syscall exit, which is the number of bytes actually read:

Click here to view code image


# argdist -H 't:syscalls:sys_exit_read():int:args->ret'
[09:12:58]
     args->ret           : count     distribution
         0 -> 1          : 481      |****************************************|
         2 -> 3          : 116      |*********                               |
         4 -> 7          : 1        |                                        |
         8 -> 15         : 29       |**                                      |
        16 -> 31         : 6        |                                        |
        32 -> 63         : 31       |**                                      |
        64 -> 127        : 8        |                                        |
       128 -> 255        : 2        |                                        |
       256 -> 511        : 1        |                                        |
       512 -> 1023       : 2        |                                        |
      1024 -> 2047       : 13       |*                                       |
      2048 -> 4095       : 2        |                                        |

[...]

These are mostly zero- or one-byte reads.

Thanks to its in-kernel summary, argdist(8) is useful for examining syscalls that were called frequently. trace(8) prints per-event output and is suited for examining less-frequent syscalls, showing per-event timestamps and other details.

bpftrace
This level of syscall analysis is possible using bpftrace one-liners. For example, examining the requested read size as a histogram:

Click here to view code image


# bpftrace -e 't:syscalls:sys_enter_read { @ = hist(args->count); }'
Attaching 1 probe...
^C

@:
[1]                 1102 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[2, 4)               902 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@          |
[4, 8)                20 |                                                    |
[8, 16)               17 |                                                    |
[16, 32)             538 |@@@@@@@@@@@@@@@@@@@@@@@@@                           |
[32, 64)              56 |@@                                                  |
[64, 128)              0 |                                                    |
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              0 |                                                    |
[1K, 2K)             119 |@@@@@                                               |
[2K, 4K)              26 |@                                                   |
[4K, 8K)             334 |@@@@@@@@@@@@@@@                                     |

And the return value:

Click here to view code image


# bpftrace -e 't:syscalls:sys_exit_read { @ = hist(args->ret); }'
Attaching 1 probe...
^C

@:
(..., 0)             105 |@@@@                                                |
[0]                   18 |                                                    |
[1]                 1161 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[2, 4)               196 |@@@@@@@@                                            |
[4, 8)                 8 |                                                    |
[8, 16)              384 |@@@@@@@@@@@@@@@@@                                   |
[16, 32)              87 |@@@                                                 |
[32, 64)             118 |@@@@@                                               |
[64, 128)             37 |@                                                   |
[128, 256)             6 |                                                    |
[256, 512)            13 |                                                    |
[512, 1K)              3 |                                                    |
[1K, 2K)               3 |                                                    |
[2K, 4K)              15 |                                                    |

bpftrace has a separate bucket for negative values (“(..., 0)”), which are error codes returned by read(2) to indicate an error. You can craft a bpftrace one-liner to print these as a frequency count (as shown in Chapter 5) or a linear histogram so that the individual numbers can be seen:

Click here to view code image


#  bpftrace -e 't:syscalls:sys_exit_read /args->ret < 0/ {
    @ = lhist(- args->ret, 0, 100, 1); }'
Attaching 1 probe...
^C

@:
[11, 12)             123 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

This output shows that error code 11 was always returned. Checking the Linux headers (asm-generic/errno-base.h):

Click here to view code image


#define EAGAIN          11      /* Try again */

Error code 11 is for “try again,” an error state that can occur in normal operation.

6.3.12 funccount
funccount(8), introduced in Chapter 4, is a BCC tool that can frequency-count functions and other events. It can be used to provide more context for software CPU usage, showing which functions are called and how frequently. profile(8) may be able to show that a function is hot on CPU, but it can’t explain why20: whether the function is slow, or whether it was simply called millions of times per second.

20 profile(8) can’t explain this easily. Profilers including profile(8) sample the CPU instruction pointer, and so a comparison with the function’s disassembly may show whether it was stuck in a loop or called many times. In practice, it can be harder than it sounds: see Section 2.12.2 in Chapter 2.

As an example, this frequency-counts kernel TCP functions on a busy production instance by matching those that begin with “tcp_”:

Click here to view code image


# funccount 'tcp_*'
Tracing 316 functions for "tcp_*"... Hit Ctrl-C to end.
^C
FUNC                                    COUNT
[...]
tcp_stream_memory_free                 368048
tcp_established_options                381234
tcp_v4_md5_lookup                      402945
tcp_gro_receive                        484571
tcp_md5_do_lookup                      510322
Detaching...

This output shows that tcp_md5_do_lookup() was most frequent, with 510,000 calls while tracing.

Per-interval output can be generated using -i. For example, the earlier profile(8) output shows that the function get_page_from_freelist() was hot on CPU. Was that because it was called often or because it was slow? Measuring its per-second rate:

Click here to view code image


# funccount -i 1 get_page_from_freelist
Tracing 1 functions for "get_page_from_freelist"... Hit Ctrl-C to end.

FUNC                                    COUNT
get_page_from_freelist                 586452

FUNC                                    COUNT
get_page_from_freelist                 586241
[...]

The function was called over half a million times per second.

This works by using dynamic tracing of the function: It uses kprobes for kernel functions and uprobes for user-level functions (kprobes and uprobes are explained in Chapter 2). The overhead of this tool is relative to the rate of the functions. Some functions, such as malloc() and get_page_from_freelist(), tend to occur frequently, so tracing them can slow down the target application significantly, in excess of 10 percent—use caution. See Section 18.1 in Chapter 18 for more about understanding overhead.

Command line usage:

Click here to view code image


funccount [options] [-i interval] [-d duration] pattern

Options include:

-r: Use regular expressions for the pattern match

-p PID: Measures this process only

Patterns:

name or p:name: Instrument the kernel function called name()

lib:name: Instrument the user-level function called name() in library lib

path:name: Instrument the user-level function called name() in the file at path

t:system:name: Instruments the tracepoint called system:name

*: A wildcard to match any string (globbing)

See Section 4.5 in Chapter 4 for more examples.

bpftrace
The core functionality of funccount(8) can be implemented as a bpftrace one-liner:

Click here to view code image


# bpftrace -e 'k:tcp_* { @[probe] = count(); }'
Attaching 320 probes...
[...]
@[kprobe:tcp_release_cb]: 153001
@[kprobe:tcp_v4_md5_lookup]: 154896
@[kprobe:tcp_gro_receive]: 177187

This can be adjusted to do per-interval output, for example, with this addition:

Click here to view code image


interval:s:1 { print(@); clear(@); }

As with BCC, use caution when tracing frequent functions, as they may incur significant overhead.

6.3.13 softirqs
softirqs(8) is a BCC tool that shows the time spent servicing soft IRQs (soft interrupts). The system-wide time in soft interrupts is readily available from different tools. For example, mpstat(1) shows it as %soft. There is also /proc/softirqs to show counts of soft IRQ events. The BCC softirqs(8) tool differs in that it can show time per soft IRQ rather than event count.

For example, from a 48-CPU production instance and a 10-second trace:

Click here to view code image


# softirqs 10 1
Tracing soft irq event time... Hit Ctrl-C to end.

SOFTIRQ          TOTAL_usecs
net_tx                   633
tasklet                30939
rcu                   143859
sched                 185873
timer                 389144
net_rx               1358268

This output shows that the most time was spent servicing net_rx, totaling 1358 milliseconds. This is significant, as it works out to be 3 percent of the CPU time on this 48-CPU system.

softirqs(8) works by using the irq:softirq_enter and irq:softirq_exit tracepoints. The overhead of this tool is relative to the event rate, which could be high for busy production systems and high network packet rates. Use caution and check overhead.

Command line usage:

Click here to view code image


softirqs [options] [interval [count]]

Options include:

-d: Shows IRQ time as histograms

-T: Includes timestamps on output

The -d option can be used to explore the distribution and identify whether there are latency outliers while servicing these interrupts.

bpftrace
A bpftrace version of softirqs(8) does not exist, but could be created. The following one-liner is a starting point, counting IRQs by vector ID:

Click here to view code image


# bpftrace -e 'tracepoint:irq:softirq_entry { @[args->vec] = count(); }'
Attaching 1 probe...
^C

@[3]: 11
@[6]: 45
@[0]: 395
@[9]: 405
@[1]: 524
@[7]: 561

These vector IDs can be translated to the softirq names in the same way the BCC tool does this: by using a lookup table. Determining the time spent in soft IRQs involves tracing the irq:softirq_exit tracepoint as well.

6.3.14 hardirqs
hardirqs(8)21 is a BCC tool that shows time spent servicing hard IRQs (hard interrupts). The system-wide time in hard interrupts is readily available from different tools. For example, mpstat(1) shows it as %irq. There is also /proc/interrupts to show counts of hard IRQ events. The BCC hardirqs(8) tool differs in that it can show time per hard IRQ rather than event count.

21 Origin: I first created this as inttimes.d on 28-Jun-2005, for printing time sums and intoncpu.d for printing histograms on 9-May-2005, which was based on intr.d from the “Dynamic Tracing Guide,” Jan 2005 [Sun 05]. I also developed a DTrace tool to show interrupts by CPU but have not ported it to BPF since Linux has /proc/interrupts for that task. I developed this BCC version that does both sums and histograms on 20-Oct-2015.

For example, from a 48-CPU production instance and a 10-second trace:

Click here to view code image


# hardirqs 10 1
Tracing hard irq event time... Hit Ctrl-C to end.

HARDIRQ                    TOTAL_usecs
ena-mgmnt@pci:0000:00:05.0          43
nvme0q0                             46
eth0-Tx-Rx-7                     47424
eth0-Tx-Rx-6                     48199
eth0-Tx-Rx-5                     48524
eth0-Tx-Rx-2                     49482
eth0-Tx-Rx-3                     49750
eth0-Tx-Rx-0                     51084
eth0-Tx-Rx-4                     51106
eth0-Tx-Rx-1                     52649

This output shows that several hard IRQs named eth0-Tx-Rx* had total times of around 50 milliseconds for this 10-second trace.

hardirqs(8) can provide insight for CPU usage that is not visible to CPU profilers. See the Internals section of Section 6.2.4 for profiling on cloud instances that lack a hardware PMU.

This tool currently works by using dynamic tracing of the handle_irq_event_percpu() kernel function, although a future version should switch to the irq:irq_handler_entry and irq:irq_handler_exit tracepoints.

Command line usage:

Click here to view code image


hardirqs [options] [interval [count]]

Options include:

-d: Shows IRQ time as histograms

-T: Includes timestamps on output

The -d option can be used to explore the distribution and identify whether there are latency outliers while servicing these interrupts.

6.3.15 smpcalls
smpcalls(8)22 is a bpftrace tool to trace and summarize time in the SMP call functions (also known as cross calls). These are a way for one CPU to run functions on other CPUs, including all other CPUs, which can become an expensive activity on large multi-processor systems. For example, on a 36-CPU system:

22 Origin: I created smpcalls.bt for this book on 23-Jan-2019. The name comes from my earlier tool, xcallsbypid.d (named after CPU cross calls), which I created on 17-Sep-2005.

Click here to view code image


234# smpcalls.bt
Attaching 8 probes...
Tracing SMP calls. Hit Ctrl-C to stop.
^C

@time_ns[do_flush_tlb_all]:
[32K, 64K)             1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64K, 128K)            1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@time_ns[remote_function]:
[4K, 8K)               1 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[8K, 16K)              1 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[16K, 32K)             0 |                                                    |
[32K, 64K)             2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@time_ns[do_sync_core]:
[32K, 64K)            15 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64K, 128K)            9 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                     |

@time_ns[native_smp_send_reschedule]:
[2K, 4K)               7 |@@@@@@@@@@@@@@@@@@@                                 |
[4K, 8K)               3 |@@@@@@@@                                            |
[8K, 16K)             19 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16K, 32K)             3 |@@@@@@@@                                            |

@time_ns[aperfmperf_snapshot_khz]:
[1K, 2K)               5 |@                                                   |
[2K, 4K)              12 |@@@                                                 |
[4K, 8K)              12 |@@@                                                 |
[8K, 16K)              6 |@                                                   |
[16K, 32K)             1 |                                                    |
[32K, 64K)           196 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64K, 128K)           20 |@@@@@                                               |

This is the first time I’ve run this tool, and it’s identified an issue right away: The aperfmperf_snapshot_khz cross call is relatively frequent and slow, taking up to 128 microseconds.

The source to smpcalls(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing SMP calls. Hit Ctrl-C to stop.\n");
}

kprobe:smp_call_function_single,
kprobe:smp_call_function_many
{
        @ts[tid] = nsecs;
        @func[tid] = arg1;
}

kretprobe:smp_call_function_single,
kretprobe:smp_call_function_many
/@ts[tid]/
{
        @time_ns[ksym(@func[tid])] = hist(nsecs - @ts[tid]);
        delete(@ts[tid]);
        delete(@func[tid]);
}

kprobe:native_smp_send_reschedule
{
        @ts[tid] = nsecs;
        @func[tid] = reg("ip");
}

kretprobe:native_smp_send_reschedule
/@ts[tid]/
{
        @time_ns[ksym(@func[tid])] = hist(nsecs - @ts[tid]);
        delete(@ts[tid]);
        delete(@func[tid]);
}

END
{
        clear(@ts);
        clear(@func);
}

Many of the SMP calls are traced via kprobes for the smp_call_function_single() and smp_call_function_many() kernel functions. The entry to these functions has the remote CPU function as the second argument, which bpftrace accesses as arg1 and stores keyed by thread ID for lookup in the kretprobe. It is then converted into the human-readable symbol by the bpftrace ksym() built-in.

There is a special SMP call not covered by those functions, smp_send_reschedule(), which is traced via native_smp_send_reschedule(). I hope that a future kernel version supports SMP call tracepoints to simplify tracing of these calls.

The @time_ns histogram key can be modified to include the kernel stack trace and process name:

Click here to view code image


        @time_ns[comm, kstack, ksym(@func[tid])] = hist(nsecs - @ts[tid]);

This includes more details for the slow call:

Click here to view code image


@time_ns[snmp-pass,
    smp_call_function_single+1
    aperfmperf_snapshot_cpu+90
    arch_freq_prepare_all+61
    cpuinfo_open+14
    proc_reg_open+111
    do_dentry_open+484
    path_openat+692
    do_filp_open+153
    do_sys_open+294
    do_syscall_64+85
    entry_SYSCALL_64_after_hwframe+68
, aperfmperf_snapshot_khz]:
[2K, 4K)               2 |@@                                                  |
[4K, 8K)               0 |                                                    |
[8K, 16K)              1 |@                                                   |
[16K, 32K)             1 |@                                                   |
[32K, 64K)            51 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64K, 128K)           17 |@@@@@@@@@@@@@@@@@                                   |

This output shows that the process was snmp-pass, a monitoring agent, and it was doing an open() syscall that ends up in cpuinfo_open() and an expensive cross call.

Using another BPF tool, opensnoop(8), quickly confirms this behavior:

Click here to view code image


# opensnoop.py -Tn snmp-pass
TIME(s)       PID    COMM               FD ERR PATH
0.000000000   2440   snmp-pass           4   0 /proc/cpuinfo
0.000841000   2440   snmp-pass           4   0 /proc/stat
1.022128000   2440   snmp-pass           4   0 /proc/cpuinfo
1.024696000   2440   snmp-pass           4   0 /proc/stat
2.046133000   2440   snmp-pass           4   0 /proc/cpuinfo
2.049020000   2440   snmp-pass           4   0 /proc/stat
3.070135000   2440   snmp-pass           4   0 /proc/cpuinfo
3.072869000   2440   snmp-pass           4   0 /proc/stat
[...]

This output shows that snmp-pass is reading the /proc/cpuinfo file every second! Most of the details in this file will not change, with the exception of the “cpu MHz” field.

Inspection of the software showed that it was reading /proc/cpuinfo merely to count the number of processors; the “cpu MHz” field was not used at all. This is an example of unnecessary work, and eliminating it should provide a small but easy win.

On Intel processors, these SMP calls are ultimately implemented as x2APIC IPI (inter-processor interrupt) calls, including x2apic_send_IPI(). These can also be instrumented, as shown in Section 6.4.2.

6.3.16 llcstat
llcstat(8)23 is a BCC tool that uses PMCs to show last-level cache (LLC) miss rates and hit ratios by process. PMCs are introduced in Chapter 2.

23 Origin: This was created by Teng Qin on 19-Oct-2016, and is the first tool in BCC to use PMCs.

For example, from a 48-CPU production instance:

Click here to view code image


# llcstat
Running for 10 seconds or hit Ctrl-C to end.
PID      NAME             CPU     REFERENCE         MISS    HIT%
0        swapper/15       15        1007300         1000  99.90%
4435     java             18          22000          200  99.09%
4116     java             7           11000          100  99.09%
4441     java             38          32200          300  99.07%
17387    java             17          10800          100  99.07%
4113     java             17          10500          100  99.05%
[...]

This output shows that the java processes (threads) were running with a very high hit ratio, over 99%.

This tool works by using overflow sampling of PMCs, where one in every so many cache references or misses triggers a BPF program to read the currently running process and record stats. The default threshold is 100, and it can be tuned using -c. This one-in-a-hundred sampling helps keep the overhead low (and can be tuned to higher numbers, if needed); however, there are some issues related to sampling with it. For example, a process could by chance overflow misses more often than references, which doesn’t make sense (as misses are a subset of references).

Command line usage:

Click here to view code image


llcstat [options] [duration]

Options include:

-c SAMPLE_PERIOD: Sample one in this many events only

llcstat(8) is interesting in that it was the first BCC tool to use PMCs, outside of timed sampling.

6.3.17 Other Tools
Other BPF tools worth mentioning:

cpuwalk(8) from bpftrace samples which processes CPUs were running on and prints the result as a linear histogram. This provides a histogram view of CPU balance.

cpuunclaimed(8) from BCC is an experimental tool that samples CPU run queue lengths and determines how often there are idle CPUs yet threads in a runnable state on a different run queue. This sometimes happens due to CPU affinity, but if it happens often, it may be a sign of a scheduler misconfiguration or bug.

loads(8) from bpftrace is an example of fetching the load averages from a BPF tool. As discussed earlier, these numbers are misleading.

vltrace is a tool in development by Intel that will be a BPF-powered version of strace(1) that can be used for further characterization of syscalls that are consuming CPU time [79].

6.4 BPF ONE-LINERS
This section provides BCC and bpftrace one-liners. Where possible, the same one-liner is implemented using both BCC and bpftrace.

6.4.1 BCC
Trace new processes with arguments:

Click here to view code image

execsnoop
Show who is executing what:

Click here to view code image

trace 't:syscalls:sys_enter_execve "-> %s", args->filename'
Show the syscall count by process:

Click here to view code image

syscount -P
Show the syscall count by syscall name:

Click here to view code image

syscount
Sample user-level stacks at 49 Hertz, for PID 189:

Click here to view code image

profile -F 49 -U -p 189
Sample all stack traces and process names:

Click here to view code image

profile
Count kernel functions beginning with “vfs_”:

Click here to view code image

funccount 'vfs_*'
Trace new threads via pthread_create():

Click here to view code image

trace /lib/x86_64-linux-gnu/libpthread-2.27.so:pthread_create
6.4.2 bpftrace
Trace new processes with arguments:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_execve { join(args->argv); }'
Show who is executing what:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_execve { printf("%s -> %s\n", comm,
    str(args->filename)); }'
Show the syscall count by program:

Click here to view code image

bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
Show the syscall count by process:

Click here to view code image

bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[pid, comm] = count(); }'
Show the syscall count by syscall probe name:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[probe] = count(); }'
Show the syscall count by syscall function:

Click here to view code image

bpftrace -e 'tracepoint:raw_syscalls:sys_enter {
    @[sym(*(kaddr("sys_call_table") + args->id * 8))] = count(); }'
Sample running process names at 99 Hertz:

Click here to view code image

bpftrace -e 'profile:hz:99 { @[comm] = count(); }'
Sample user-level stacks at 49 Hertz, for PID 189:

Click here to view code image

bpftrace -e 'profile:hz:49 /pid == 189/ { @[ustack] = count(); }'
Sample all stack traces and process names:

Click here to view code image

bpftrace -e 'profile:hz:49 { @[ustack, stack, comm] = count(); }'
Sample the running CPU at 99 Hertz and show it as a linear histogram:

Click here to view code image

bpftrace -e 'profile:hz:99 { @cpu = lhist(cpu, 0, 256, 1); }'
Count kernel functions beginning with vfs_:

Click here to view code image

bpftrace -e 'kprobe:vfs_* { @[func] = count(); }'
Count SMP calls by name and kernel stack:

Click here to view code image

bpftrace -e 'kprobe:smp_call* { @[probe, kstack(5)] = count(); }'
Count Intel x2APIC calls by name and kernel stack:

Click here to view code image

bpftrace -e 'kprobe:x2apic_send_IPI* { @[probe, kstack(5)] = count(); }'
Trace new threads via pthread_create():

Click here to view code image

bpftrace -e 'u:/lib/x86_64-linux-gnu/libpthread-2.27.so:pthread_create {
    printf("%s by %s (%d)\n", probe, comm, pid); }'
6.5 OPTIONAL EXERCISES
If not specified, these can be completed using either bpftrace or BCC:

Use execsnoop(8) to show the new processes for the man ls command.

Run execsnoop(8) with -t and output to a log file for 10 minutes on a production or local system. What new processes did you find?

On a test system, create an overloaded CPU. This creates two CPU-bound threads that are bound to CPU 0:

Click here to view code image


taskset -c 0 sh -c 'while :; do :; done' &
taskset -c 0 sh -c 'while :; do :; done' &

Now use uptime(1) (load averages), mpstat(1) (-P ALL), runqlen(8), and runqlat(8) to characterize the workload on CPU 0. (Remember to kill the workload when you are done.)

Develop a tool/one-liner to sample kernel stacks on CPU 0 only.

Use profile(8) to capture kernel CPU stacks to determine where CPU time is spent by the following workload:

Click here to view code image


dd if=/dev/nvme0n1p3 bs=8k iflag=direct | dd of=/dev/null bs=1

Modify the infile (if=) device to be a local disk (see df -h for a candidate). You can either profile system-wide or filter for each of those dd(1) processes.

Generate a CPU flame graph of the Exercise 5 output.

Use offcputime(8) to capture kernel CPU stacks to determine where blocked time is spent for the workload of Exercise 5.

Generate an off-CPU time flame graph for the output of Exercise 7.

execsnoop(8) only sees new processes that call exec(2) (execve(2)), although some may fork(2) or clone(2) and not exec(2) (e.g., the creation of worker processes). Write a new tool called procsnoop(8) to show all new processes with as many details as possible. You could trace fork() and clone(), or use the sched tracepoints, or do something else.

Develop a bpftrace version of softirqs(8) that prints the softirq name.

Implement cpudist(8) in bpftrace.

With cpudist(8) (either version), show separate histograms for voluntary and involuntary context switches.

(Advanced, unsolved) Develop a tool to show a histogram of time spent by tasks in CPU affinity wait: runnable while other CPUs are idle but not migrated due to cache warmth (see kernel.sched_migration_cost_ns, task_hot()—which may be inlined and not traceable, and can_migrate_task()).

6.6 SUMMARY
This chapter summarizes how CPUs are used by a system, and how to analyze them using traditional tools: statistics, profilers, and tracers. This chapter also shows how to use BPF tools to uncover issues of short-lived processes, examine run queue latency in detail, profile CPU usage efficiency, count function calls, and show CPU usage by soft and hard interrupts.

CopyAdd HighlightAdd Note
back to top
