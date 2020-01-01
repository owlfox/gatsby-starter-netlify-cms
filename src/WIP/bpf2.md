# Chapter 1. Introduction
This chapter introduces some key terminology, summarizes technologies, and demonstrates some BPF performance tools. These technologies will be explained in more detail in the following chapters.

1.1 WHAT ARE BPF AND EBPF?
BPF stands for Berkeley Packet Filter, an obscure technology first developed in 1992 that improved the performance of packet capture tools [McCanne 92]. In 2013, Alexei Starovoitov proposed a major rewrite of BPF [2], which was further developed by Alexei and Daniel Borkmann and included in the Linux kernel in 2014 [3]. This turned BPF into a general-purpose execution engine that can be used for a variety of things, including the creation of advanced performance analysis tools.

BPF can be difficult to explain precisely because it can do so much. It provides a way to run mini programs on a wide variety of kernel and application events. If you are familiar with JavaScript, you may see some similarities: JavaScript allows a website to run mini programs on browser events such as mouse clicks, enabling a wide variety of web-based applications. BPF allows the kernel to run mini programs on system and application events, such as disk I/O, thereby enabling new system technologies. It makes the kernel fully programmable, empowering users (including non-kernel developers) to customize and control their systems in order to solve real-world problems.

BPF is a flexible and efficient technology composed of an instruction set, storage objects, and helper functions. It can be considered a virtual machine due to its virtual instruction set specification. These instructions are executed by a Linux kernel BPF runtime, which includes an interpreter and a JIT compiler for turning BPF instructions into native instructions for execution. BPF instructions must first pass through a verifier that checks for safety, ensuring that the BPF program will not crash or corrupt the kernel (it doesn’t, however, prevent the end user from writing illogical programs that may execute but not make sense). The components of BPF are explained in detail in Chapter 2.

So far, the three main uses of BPF are networking, observability, and security. This book focuses on observability (tracing).

Extended BPF is often abbreviated as eBPF, but the official abbreviation is still BPF, without the “e,” so throughout this book I use BPF to refer to extended BPF. The kernel contains only one execution engine, BPF (extended BPF), which runs both extended BPF and “classic” BPF programs.1

1 Classic BPF programs (which refers to the original BPF [McCanne 92]) are automatically migrated to the extended BPF engine by the kernel for execution. Classic BPF is also not being developed further.

1.2 WHAT ARE TRACING, SNOOPING, SAMPLING, PROFILING, AND OBSERVABILITY?
These are all terms used to classify analysis techniques and tools.

Tracing is event-based recording—the type of instrumentation that these BPF tools use. You may have already used some special-purpose tracing tools. Linux strace(1), for example, records and prints system call events. There are many tools that do not trace events, but instead measure events using fixed statistical counters and then print summaries; Linux top(1) is an example. A hallmark of a tracer is its ability to record raw events and event metadata. Such data can be voluminous, and it may need to be post-processed into summaries. Programmatic tracers, which BPF makes possible, can run small programs on the events to do custom on-the-fly statistical summaries or other actions, to avoid costly post-processing.

While strace(1) has “trace” in its name, not all tracers do. tcpdump(8), for example, is another specialized tracer for network packets. (Perhaps it should have been named tcptrace?) The Solaris operating system had its own version of tcpdump called snoop(1M)2, so named because it was used to snoop network packets. I was first to develop and publish many tracing tools, and did so on Solaris, where I (perhaps regrettably) used the “snooping” terminology for my earlier tools. This is why we now have execsnoop(8), opensnoop(8), biosnoop(8), etc. Snooping, event dumping, and tracing usually refer to the same thing. These tools are covered in later chapters.

2 For Solaris, section 1M of the man pages is for maintenance and administration commands (section 8 on Linux).

Apart from tool names, the term tracing is also used, especially by kernel developers, to describe BPF when used for observability.

Sampling tools take a subset of measurements to paint a coarse picture of the target; this is also known as creating a profile or profiling. There is a BPF tool called profile(8) that takes timer-based samples of running code. For example, it can sample every 10 milliseconds, or, put differently, it can take 100 samples per second (on every CPU). An advantage of samplers is that their performance overhead can be lower than that of tracers, since they only measure one out of a much larger set of events. A disadvantage is that sampling provides only a rough picture and can miss events.

Observability refers to understanding a system through observation, and classifies the tools that accomplish this. These tools includes tracing tools, sampling tools, and tools based on fixed counters. It does not include benchmark tools, which modify the state of the system by performing a workload experiment. The BPF tools in this book are observability tools, and they use BPF for programmatic tracing.

1.3 WHAT ARE BCC, BPFTRACE, AND IO VISOR?
It is extremely tedious to code BPF instructions directly, so front ends have been developed that provide higher-level languages; the main ones for tracing are BCC and bpftrace.


Figure 1-1 BCC, bpftrace, and BPF

BCC (BPF Compiler Collection) was the first higher-level tracing framework developed for BPF. It provides a C programming environment for writing kernel BPF code and other languages for the user-level interface: Python, Lua, and C++. It is also the origin of the libbcc and current libbpf libraries,3 which provide functions for instrumenting events with BPF programs. The BCC repository also contains more than 70 BPF tools for performance analysis and troubleshooting. You can install BCC on your system and then run the tools provided, without needing to write any BCC code yourself. This book will give you a tour of many of these tools.

3 The first libbpf was developed by Wang Nan for use with perf [4]. libbpf is now part of the kernel source.

bpftrace is a newer front end that provides a special-purpose, high-level language for developing BPF tools. bpftrace code is so concise that tool source code is usually included in this book, to show what the tool is instrumenting and how it is processed. bpftrace is built upon the libbcc and libbpf libraries.

BCC and bpftrace are pictured in Figure 1-1. They are complementary: Whereas bpftrace is ideal for powerful one-liners and custom short scripts, BCC is better suited for complex scripts and daemons, and can make use of other libraries. For example, many of the Python BCC tools use the Python argparse library to provide complex and fine control of tool command line arguments.

Another BPF front end, called ply, is in development [5]; it is designed to be lightweight and require minimal dependencies, which makes it a good fit for embedded Linux environments. If ply is better suited to your environment than bpftrace, you will nonetheless find this book useful as a guide for what you can analyze with BPF. Dozens of the bpftrace tools in this book can be executed using ply after switching to ply’s syntax. (A future version of ply may support the bpftrace syntax directly.) This book focuses on bpftrace because it has had more development and has all the features needed to analyze all targets.

BCC and bpftrace do not live in the kernel code base but in a Linux Foundation project on github called IO Visor. Their repositories are:

https://github.com/iovisor/bcc

https://github.com/iovisor/bpftrace

Throughout this book I use the term BPF tracing to refer to both BCC and bpftrace tools.

1.4 A FIRST LOOK AT BCC: QUICK WINS
Let’s cut to the chase and look at some tool output for some quick wins. The following tool traces new processes and prints a one-line summary for each one as it begins. This particular tool, execsnoop(8) from BCC, works by tracing the execve(2) system call, which is an exec(2) variant (hence its name). Installation of BCC tools is covered in Chapter 4, and later chapters will introduce these tools in more detail.

Click here to view code image


# execsnoop
PCOMM            PID    PPID   RET ARGS
run              12983  4469     0 ./run
bash             12983  4469     0 /bin/bash
svstat           12985  12984    0 /command/svstat /service/httpd
perl             12986  12984    0 /usr/bin/perl -e $l=<>;$l=~/(\d+) sec/;print $1||0
ps               12988  12987    0 /bin/ps --ppid 1 -o pid,cmd,args
grep             12989  12987    0 /bin/grep org.apache.catalina
sed              12990  12987    0 /bin/sed s/^ *//;
cut              12991  12987    0 /usr/bin/cut -d  -f 1
xargs            12992  12987    0 /usr/bin/xargs
echo             12993  12992    0 /bin/echo
mkdir            12994  12983    0 /bin/mkdir -v -p /data/tomcat
mkdir            12995  12983    0 /bin/mkdir -v -p /apps/tomcat/webapps
^C
#

The output reveals which processes were executed while tracing: processes that may be so short-lived that they are invisible to other tools. There are many lines of output, showing standard Unix utilities: ps(1), grep(1), sed(1), cut(1), etc. What you can’t see just from looking at this output on the page is how quickly it is printed. The -t option can be used with execsnoop(8) to print a timestamp column:

Click here to view code image


# execsnoop -t
TIME(s) PCOMM        PID    PPID   RET ARGS
0.437   run          15524  4469     0 ./run
0.438   bash         15524  4469     0 /bin/bash
0.440   svstat       15526  15525    0 /command/svstat /service/httpd
0.440   perl         15527  15525    0 /usr/bin/perl -e $l=<>;$l=~/(\d+) sec/;prin...
0.442   ps           15529  15528    0 /bin/ps --ppid 1 -o pid,cmd,args
[...]
0.487   catalina.sh  15524  4469     0 /apps/tomcat/bin/catalina.sh start
0.488   dirname      15549  15524    0 /usr/bin/dirname /apps/tomcat/bin/catalina.sh
1.459   run          15550  4469     0 ./run
1.459   bash         15550  4469     0 /bin/bash
1.462   svstat       15552  15551    0 /command/svstat /service/nflx-httpd
1.462   perl         15553  15551    0 /usr/bin/perl -e $l=<>;$l=~/(\d+) sec/;prin...
[...]

I’ve truncated the output (as indicated by the […]), but the timestamp column shows a new clue: The time between new processes jumps by one second, and this pattern repeats. By browsing the output, I could see that 30 new processes were launched every second, followed by a one-second pause between these batches of 30 processes.

The output shown here is taken from a real-world issue at Netflix that I debugged using execsnoop(8). This was occurring on a server used for micro-benchmarking, but the benchmark results showed too much variance to be trusted. I ran execsnoop(8) when the system was supposed to be idle, and discovered that it wasn’t! Every second these processes were launched, and they were perturbing our benchmarks. The cause turned out to be a misconfigured service that was attempting to launch every second, failing, and starting again. Once the service was deactivated, these processes stopped (as confirmed using execsnoop(8)), and then the benchmark numbers became consistent.

The output from execsnoop(8) aids a performance analysis methodology called workload characterization, which is supported by many other BPF tools in this book. This methodology is simple: Define what workload is being applied. Understanding the workload is often sufficient for solving problems, and avoids needing to dig deeper into latencies or to do drill-down analysis. In this case, it was the process workload applied to the system. Chapter 3 introduces this and other methodologies.

Try running execsnoop(8) on your systems and leave it running for an hour. What do you find?

execsnoop(8) prints per-event data, but other tools use BPF to calculate efficient summaries. Another tool you can use for quick wins is biolatency(8), which summarizes block device I/O (disk I/O) as a latency histogram.

The following is output from running biolatency(8) on a production database that is sensitive to high latency as it has a service level agreement to deliver requests within a certain number of milliseconds.

Click here to view code image


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
       512 -> 1023       : 11       |                                        |

While the biolatency(8) tool is running, block I/O events are instrumented and their latencies are calculated and summarized by BPF. When the tool stops running (when the user presses Ctrl-C), the summary is printed. I used the -m option here to print the summary in milliseconds.

There are interesting details in this output, which shows a bi-modal distribution as well as latency outliers. The largest mode (as visualized by the ASCII distribution) is for the 0- to 1-millisecond range, with 16,355 I/O in that range while tracing. This is fast, and likely due to on-disk cache hits as well as flash memory devices. The second mode stretches to the 32- to 63-millisecond range, which is much slower than expected from these storage devices and suggests queuing. More BPF tools can be used to drill deeper to confirm. Finally, for the 512- to 1023-millisecond range, there were 11 I/O. These very slow I/O are termed latency outliers. Now that we know they exist, they can be examined in more detail with other BPF tools. For the database team, these are the priority to study and solve: If the database is blocked on these I/O, the database will exceed its latency target.

1.5 BPF TRACING VISIBILITY
BPF tracing gives you visibility across the full software stack and allows new tools and instrumentation to be created on demand. You can use BPF tracing in production immediately, without needing to reboot the system or restart applications in any special mode. It can feel like having X-ray vision: When you need to examine some deep kernel component, device, or application library, you can see into it in a way that no one ever has before—live and in production.

To illustrate, Figure 1-2 shows a generic system software stack that I’ve annotated with BPF-based performance tools for observing different components. These tools are from BCC, bpftrace, and this book. Many of them will be explained in later chapters.


Figure 1-2 BPF performance tools and their visibility

Consider the different tools you would use to examine components such as the kernel CPU scheduler, virtual memory, file systems, and so on. By simply browsing this diagram, you might discover former blindspots that you can observe with BPF tools.

The traditional tools used to examine these components are summarized in Table 1-1, along with whether BPF tracing can observe these components.

Table 1-1 Traditional Analysis Tools

Components

Traditional Analysis Tools

BPF Tracing

Applications with language runtimes: Java, Node.js, Ruby, PHP

Runtime debuggers

Yes, with runtime support

Applications using compiled code: C, C++, Golang

System debuggers

Yes

System libraries: /lib/*

ltrace(1)

Yes

System call interface

strace(1), perf(1)

Yes

Kernel: Scheduler, file systems, TCP, IP, etc

Ftrace, perf(1) for sampling

Yes, in more detail

Hardware: CPU internals, devices

perf, sar, /proc counters

Yes, direct or indirect4

4 BPF may not be able to directly instrument the firmware on a device, but it may be able to indirectly infer behavior based on tracing of kernel driver events or PMCs.

Traditional tools can provide useful starting points for analysis, which you can explore in more depth with BPF tracing tools. Chapter 3 summarizes basic performance analysis with system tools, which can be your starting point.

1.6 DYNAMIC INSTRUMENTATION: KPROBES AND UPROBES
BPF tracing supports multiple sources of events to provide visibility of the entire software stack. One that deserves special mention is dynamic instrumentation (also called dynamic tracing)—the ability to insert instrumentation points into live software, in production. Dynamic instrumentation costs zero overhead when not in use, as software runs unmodified. It is often used by BPF tools to instrument the start and end of kernel and application functions, from the many tens of thousands of functions that are typically found running in a software stack. This provides visibility so deep and comprehensive that it can feel like a superpower.

Dynamic instrumentation was first created in the 1990s [Hollingsworth 94], based on a technique used by debuggers to insert breakpoints at arbitrary instruction addresses. With dynamic instrumentation, the target software records information and then automatically continues execution rather than passing control to an interactive debugger. Dynamic tracing tools (e.g., kerninst [Tamches 99]) were developed, and included tracing languages, but these tools remained obscure and little used. In part because they involved considerable risk: Dynamic tracing requires modification of instructions in an address space, live, and any error could lead to immediate corruption and process or kernel crashes.

Dynamic instrumentation was first developed for Linux in 2000 as DProbes by a team at IBM, but the patch set was rejected.5 Dynamic instrumentation for kernel functions (kprobes) was finally added to Linux in 2004, originating from DProbes, although it was still not well known and was still difficult to use.

5 The reasons for Linux rejecting DProbes are discussed as the first case study in On submitting kernel patches by Andi Kleen, which is referenced in the Linux source in Documentation/process/submitting-patches.rst [6].

Everything changed in 2005, when Sun Microsystems launched its own version of dynamic tracing, DTrace, with its easy-to-use D language, and included it in the Solaris 10 operating system. Solaris was known and trusted for production stability, and including DTrace as a default package install helped prove that dynamic tracing could be made safe for use in production. It was a turning point for the technology. I published many articles showing real-world use cases with DTrace and developed and published many DTrace tools. Sun marketing also promoted the technology, as did Sun sales; it was thought to be a compelling competitive feature. Sun Educational Services included DTrace in the standard Solaris courses and taught dedicated DTrace courses. All of these efforts caused dynamic instrumentation to move from an obscure technology to a well-known and in-demand feature.

Linux added dynamic instrumentation for user-level functions in 2012, in the form of uprobes. BPF tracing tools use both kprobes and uprobes for dynamic instrumentation of the full software stack.

To show how dynamic tracing is used, Table 1-2 provides examples of bpftrace probe specifiers that use kprobes and uprobes. (bpftrace is covered in Chapter 5.)

Table 1-2 bpftrace kprobe and uprobe Examples

Probe

Description

kprobe:vfs_read

Instrument the beginning of the kernel vfs_read() function

kretprobe:vfs_read

Instrument the returns6 of the kernel vfs_read() function

uprobe:/bin/bash:readline

Instrument the beginning of the readline() function in /bin/bash

uretprobe:/bin/bash:readline

Instrument the returns of the readline() function in /bin/bash

6 A function has one beginning but can have multiple ends: It can call return from different places. Return probes instrument all the return points. (See Chapter 2 for an explanation of how this works.)

1.7 STATIC INSTRUMENTATION: TRACEPOINTS AND USDT
There is a downside to dynamic instrumentation: It instruments functions that can be renamed or removed from one software version to the next. This is referred to as an interface stability issue. After upgrading the kernel or application software, you may suddenly find that your BPF tool no longer works properly. Perhaps it prints an error about being unable to find functions to instrument, or maybe it prints no output at all. Another issue is that compilers may inline functions as a compiler optimization, making them unavailable for instrumentation via kprobes or uprobes.7

7 A workaround is function offset tracing, but as an interface it is even less stable than function entry tracing.

One solution to both the stability and inlining problem is to switch to static instrumentation, where stable event names are coded into the software and maintained by the developers. BPF tracing supports tracepoints for kernel static instrumentation, and user-level statically defined tracing (USDT) for user-level static instrumentation. The downside of static instrumentation is that these instrumentation points become a maintenance burden for the developers, so if any exist, they are usually limited in number.

These details are only important if you intend to develop your own BPF tools. If so, a recommended strategy is to try using static tracing first (using tracepoints and USDT) and then switch to dynamic tracing (using kprobes and uprobes) when static tracing is unavailable.

Table 1-3 provides examples of bpftrace probe specifiers for static instrumentation using tracepoints and USDT. The open(2) tracepoint mentioned in this table is used in Section 1.8.

Table 1-3 bpftrace Tracepoint and USDT Examples

Probe

Description

tracepoint:syscalls:sys_enter_open

Instrument the open(2) syscall

usdt:/usr/sbin/mysqld:mysql: query__start

Instrument the query__start probe from /usr/sbin/mysqld

1.8 A FIRST LOOK AT BPFTRACE: TRACING OPEN()
Let’s start by using bpftrace to trace the open(2) system call (syscall). There is a tracepoint for it (syscalls:sys_enter_open8), and I’ll write a short bpftrace program at the command line: a one-liner.

8 These syscall tracepoints require the Linux CONFIG_FTRACE_SYSCALLS build option to be enabled.

You aren’t expected to understand the code in the following one-liner yet; the bpftrace language and install instructions are covered in Chapter 5. But you may be able to guess what the program does without knowing the language as it is quite intuitive (an intuitive language is a sign of good design). For now, just focus on the tool output.

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_enter_open { printf("%s %s\n", comm,
    str(args->filename)); }'
Attaching 1 probe...
slack /run/user/1000/gdm/Xauthority
slack /run/user/1000/gdm/Xauthority
slack /run/user/1000/gdm/Xauthority
slack /run/user/1000/gdm/Xauthority
^C
#

The output shows the process name and the filename passed to the open(2) syscall: bpftrace is tracing system-wide, so any application using open(2) will be seen. Each line of output summarizes one syscall, and this is an example of a tool that produces per-event output. BPF tracing can be used for more than just production server analysis. For example, I’m running it on my laptop as I write this book, and it’s showing files that a Slack chat application is opening.

The BPF program was defined within the single forward quotes, and it was compiled and run as soon as I pressed Enter to run the bpftrace command. bpftrace also activated the open(2) tracepoint. When I pressed Ctrl-C to stop the command, the open(2) tracepoint was deactivated, and my small BPF program was removed. This is how on-demand instrumentation by BPF tracing tools work: They are only activated and running for the lifetime of the command, which can be as short as seconds.

The output generated was slower than I was expecting: I think I’m missing some open(2) syscall events. The kernel supports a few variants of open, and I traced only one of them. I can use bpftrace to list all the open tracepoints by using -l and a wildcard:

Click here to view code image


# bpftrace -l 'tracepoint:syscalls:sys_enter_open*'
tracepoint:syscalls:sys_enter_open_by_handle_at
tracepoint:syscalls:sys_enter_open
tracepoint:syscalls:sys_enter_openat

Ah, I think the openat(2) variant is used more often nowadays. I’ll confirm with another bpftrace one-liner:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_enter_open* { @[probe] = count(); }'
Attaching 3 probes...
^C

@[tracepoint:syscalls:sys_enter_open]: 5
@[tracepoint:syscalls:sys_enter_openat]: 308

Again, the code in this one-liner will be explained in Chapter 5. For now, it’s only important to understand the output. It is now showing a count of these tracepoints rather than a line per event. This confirms that the openat(2) syscall is called more often—308 times while tracing—whereas the open(2) syscall was called only five times. This summary is calculated efficiently in the kernel by the BPF program.

I can add the second tracepoint to my one-liner to trace both open(2) and openat(2) at the same time. However, the one-liner will start getting a little long and unwieldy at the command line, and at that point, it would be better to save it to a script (an executable file), so that it can be more easily edited using a text editor. This has already been done for you: bpftrace ships with opensnoop.bt, which traces both the start and end of each syscall, and prints the output as columns:

Click here to view code image


# opensnoop.bt
Attaching 3 probes...
Tracing open syscalls... Hit Ctrl-C to end.
PID    COMM               FD ERR PATH
2440   snmp-pass           4   0 /proc/cpuinfo
2440   snmp-pass           4   0 /proc/stat
25706  ls                  3   0 /etc/ld.so.cache
25706  ls                  3   0 /lib/x86_64-linux-gnu/libselinux.so.1
25706  ls                  3   0 /lib/x86_64-linux-gnu/libc.so.6
25706  ls                  3   0 /lib/x86_64-linux-gnu/libpcre.so.3
25706  ls                  3   0 /lib/x86_64-linux-gnu/libdl.so.2
25706  ls                  3   0 /lib/x86_64-linux-gnu/libpthread.so.0
25706  ls                  3   0 /proc/filesystems
25706  ls                  3   0 /usr/lib/locale/locale-archive
25706  ls                  3   0 .
1744   snmpd               8   0 /proc/net/dev
1744   snmpd              -1   2 /sys/class/net/lo/device/vendor
2440   snmp-pass           4   0 /proc/cpuinfo
^C
#

The columns are process ID (PID), process command name (COMM), file descriptor (FD), error code (ERR), and the path of the file that the syscall attempted to open (PATH). The opensnoop.bt tool can be used to troubleshoot failing software, which may be attempting to open files from the wrong path, as well as to determine where config and log files are kept, based on their accesses. It can also identify some performance issues, such as files being opened too quickly, or the wrong locations being checked too frequently. It is a tool with many uses.

bpftrace ships with more than 20 such ready-to-run tools, and BCC ships with more than 70. In addition to helping you solve problems directly, these tools provide source code that shows how various targets can be traced. Sometimes there are gotchas, as we saw with tracing the open(2) syscall, and their source code may show solutions to these.

1.9 BACK TO BCC: TRACING OPEN()
Now let’s look at the BCC version of opensnoop(8):

Click here to view code image


# opensnoop
PID    COMM               FD ERR PATH
2262   DNS Res~er #657    22   0 /etc/hosts
2262   DNS Res~er #654   178   0 /etc/hosts
29588  device poll         4   0 /dev/bus/usb
29588  device poll         6   0 /dev/bus/usb/004
29588  device poll         7   0 /dev/bus/usb/004/001
29588  device poll         6   0 /dev/bus/usb/003
^C
#

The output here looks very similar to the output of the earlier one-liner—at least it has the same columns. But this opensnoop(8) output has something that the bpftrace version does not: It can be invoked with different command line options:

Click here to view code image


# opensnoop -h
usage: opensnoop [-h] [-T] [-x] [-p PID] [-t TID] [-d DURATION] [-n NAME]
                    [-e] [-f FLAG_FILTER]

Trace open() syscalls

optional arguments:
  -h, --help            show this help message and exit
  -T, --timestamp       include timestamp on output
  -x, --failed          only show failed opens
  -p PID, --pid PID     trace this PID only
  -t TID, --tid TID     trace this TID only
  -d DURATION, --duration DURATION
                        total duration of trace in seconds
  -n NAME, --name NAME  only print process names containing this name
  -e, --extended_fields
                        show extended fields
  -f FLAG_FILTER, --flag_filter FLAG_FILTER
                        filter on flags argument (e.g., O_WRONLY)

examples:
    ./opensnoop           # trace all open() syscalls
    ./opensnoop -T        # include timestamps
    ./opensnoop -x        # only show failed opens
    ./opensnoop -p 181    # only trace PID 181
    ./opensnoop -t 123    # only trace TID 123
    ./opensnoop -d 10     # trace for 10 seconds only
    ./opensnoop -n main   # only print process names containing "main"
    ./opensnoop -e        # show extended fields
    ./opensnoop -f O_WRONLY -f O_RDWR  # only print calls for writing

While bpftrace tools are typically simple and do one thing, BCC tools are typically complex and support a variety of modes of operation. While you could modify the bpftrace tool to only show failed opens, the BCC version already supports that as an option (-x):

Click here to view code image


# opensnoop -x
PID    COMM               FD ERR PATH
991    irqbalance         -1   2 /proc/irq/133/smp_affinity
991    irqbalance         -1   2 /proc/irq/141/smp_affinity
991    irqbalance         -1   2 /proc/irq/131/smp_affinity
991    irqbalance         -1   2 /proc/irq/138/smp_affinity
991    irqbalance         -1   2 /proc/irq/18/smp_affinity
20543  systemd-resolve    -1   2 /run/systemd/netif/links/5
20543  systemd-resolve    -1   2 /run/systemd/netif/links/5
20543  systemd-resolve    -1   2 /run/systemd/netif/links/5
[...]

This output shows repeated failures. Such patterns may point to inefficiencies or misconfigurations that can be fixed.

BCC tools often have several such options for changing their behavior, making them more versatile than bpftrace tools. This makes them a good starting point: hopefully they can solve your needs without you needing to write any BPF code. If, however, they do lack the visibility you need, you can then switch to bpftrace and create custom tools, as it is an easier language to develop.

A bpftrace tool can later be converted to a more complex BCC tool that supports a variety of options, like opensnoop(8) shown previously. BCC tools can also support using different events: using tracepoints when available, and switching to kprobes when not. But be aware that BCC programming is far more complex and is beyond the scope of this book, which focuses on bpftrace programming. Appendix C provides a crash course in BCC tool development.

1.10 SUMMARY
BPF tracing tools can be used for performance analysis and troubleshooting, and there are two main projects that provide them: BCC and bpftrace. This chapter introduced extended BPF, BCC, bpftrace, and the dynamic and static instrumentation that they use.

The next chapter dives into these technologies in much more detail. If you are in a hurry to solve issues, you might want to skip Chapter 2 for now and move on to Chapter 3 or a later chapter that covers the topic of interest. These later chapters make heavy use of terms, many of which are explained in Chapter 2, but they are also summarized in the Glossary.