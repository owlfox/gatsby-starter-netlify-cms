Chapter 5. bpftrace
bpftrace is an open source tracer built on BPF and BCC. Like BCC, bpftrace ships with many performance tools and supporting documentation. However, it also provides a high-level programming language that allows you to create powerful one-liners and short tools. For example, summarizing the vfs_read() return value (bytes or error value) as a histogram using bpftrace one-liner:

Click here to view code image


# bpftrace -e 'kretprobe:vfs_read { @bytes = hist(retval); }'
Attaching 1 probe...
^C

@bytes:
(..., 0)             223 |@@@@@@@@@@@@@                                       |
[0]                  110 |@@@@@@                                              |
[1]                  581 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[2, 4)                23 |@                                                   |
[4, 8)                 9 |                                                    |
[8, 16)              844 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16, 32)              44 |@@                                                  |
[32, 64)              67 |@@@@                                                |
[64, 128)             50 |@@@                                                 |
[128, 256)            24 |@                                                   |
[256, 512)             1 |                                                    |

bpftrace was created by Alastair Robertson in December 2016 as a spare-time project. Because it looked well designed and was a good fit with the existing BCC/LLVM/BPF toolchain, I joined the project and became a major contributor of code, performance tools, and documentation. We’ve now been joined by many others, and we finished adding the first set of major features during 2018.

This chapter introduces bpftrace and its features, provides an overview of its tools and documentation, explains the bpftrace programming language, and ends with a tour of bpftrace debugging and internals.

Learning objectives:

Gain knowledge of bpftrace features and how they compare to other tools

Learn where to find tools and documentation, and how to execute tools

Learn how to read the bpftrace source code included in later chapters

Develop new one-liners and tools in the bpftrace programming language

(optional) Get exposure to bpftrace internals

If you want to immediately start learning bpftrace programming, you can jump to Section 5.7 and then later return here to finish learning about bpftrace.

bpftrace is ideal for ad hoc instrumentation with custom one-liners and short scripts, whereas BCC is ideal for complex tools and daemons.

5.1 BPFTRACE COMPONENTS
The high-level directory structure of bpftrace is shown in Figure 5-1.


Figure 5-1 bpftrace structure

bpftrace contains documentation for the tools, man pages, and examples files, as well as a bpftrace programming tutorial (the one-liners tutorial) and a reference guide for the programming language. The included bpftrace tools have the extension .bt.

The front end uses lex and yacc to parse the bpftrace programming language, and Clang for parsing structures. The back end compiles bpftrace programs into LLVM intermediate representation, which is then compiled to BPF by LLVM libraries. See Section 5.16 for details.

5.2 BPFTRACE FEATURES
Feature lists can help you learn the capabilities of a new technology. I created desired feature lists for bpftrace to guide development, and these are now delivered features and are listed in this section. In Chapter 4, I grouped the BCC feature lists by kernel- and user-level features, since those are different APIs. With bpftrace, there is only one API: bpftrace programming. These bpftrace features have instead been grouped by event sources, actions, and general features.

5.2.1 bpftrace Event Sources
These event sources use kernel-level technologies that were introduced in Chapter 2. The bpftrace interface (the probe type) is shown in parentheses:

Dynamic instrumentation, kernel-level (kprobe)

Dynamic instrumentation, user-level (uprobe)

Static tracing, kernel-level (tracepoint, software)

Static tracing, user-level (usdt, via libbcc)

Timed sampling events (profile)

Interval events (interval)

PMC events (hardware)

Synthetic events (BEGIN, END)

These probe types are explained in more detail in Section 5.9. More event sources are planned in the future and may exist by the time you read this; they include sockets and skb events, raw tracepoints, memory breakpoints, and custom PMCs.

5.2.2 bpftrace Actions
These are actions that can be performed when an event fires. The following is a selection of key actions; the full list is in the bpftrace Reference Guide:

Filtering (predicates)

Per-event output (printf())

Basic variables (global, $local, and per[tid])

Built-in variables (pid, tid, comm, nsecs, …)

Associative arrays (key[value])

Frequency counting (count() or ++)

Statistics (min(), max(), sum(), avg(), stats())

Histograms (hist(), lhist())

Timestamps and time deltas (nsecs, and hash storage)

Stack traces, kernel (kstack)

Stack traces, user (ustack)

Symbol resolution, kernel-level (ksym(), kaddr())

Symbol resolution, user-level (usym(), uaddr())

C struct navigation (->)

Array access ([])

Shell commands (system())

Printing files (cat())

Positional parameters ($1, $2, …)

Actions are explained in more detail in Section 5.7. More actions may be added where there are strong use cases, but it is desirable to keep the language as small as possible to make it easier to learn.

5.2.3 bpftrace General Features
The following are general bpftrace features and components of the repository:

Low-overhead instrumentation (BPF JIT, and maps)

Production safe (BPF verifier)

Many tools (under /tools)

Tutorial (/docs/tutorial_one_liners.md)

Reference guide (/docs/reference_guide.md)

5.2.4 bpftrace Compared to Other Observability Tools
Comparing bpftrace to other tracers that can also instrument all event types:

perf(1): bpftrace provides a higher-level language that is concise, whereas the perf(1) scripting language is verbose. perf(1) supports efficient event dumping in a binary format via perf record and in-memory summary modes such as perf top. bpftrace supports efficient in-kernel summaries, such as custom histograms, whereas perf(1)’s built-in in-kernel summaries are limited to counts (perf stat). perf(1)’s capabilities can be extended by running BPF programs, although not in a high-level language like bpftrace; see Appendix D for a perf(1) BPF example.

Ftrace: bpftrace provides a higher-level language that resembles C and awk, whereas the Ftrace custom instrumentation, including hist-triggers, has a special syntax of its own. Ftrace has fewer dependencies, making it suited for tiny Linux environments. Ftrace also has instrumentation modes such as function counts that have so far been performance optimized more than the event sources used by bpftrace. (My Ftrace funccount(8) currently has faster start and stop times and lower runtime overhead than a bpftrace equivalent.)

SystemTap: Both bpftrace and SystemTap provide higher-level languages. bpftrace is based on built-in Linux technologies, whereas SystemTap adds its own kernel modules, which have proven unreliable on systems other than RHEL. Work has begun for SystemTap to support a BPF back end, as bpftrace does, which should make it reliable on these other systems. SystemTap currently has more helper functionality in its libraries (tapsets) for instrumenting different targets.

LTTng: LTTng has optimized event dumping and provides tools for analyzing event dumps. This takes a different approach to performance analysis than bpftrace, which is designed for ad hoc real-time analysis.

Application tools: Application- and runtime-specific tools are limited to user-level visibility. bpftrace can also instrument kernel and hardware events, allowing it to identify the source of issues beyond the reach of those tools. An advantage of those tools is that they are usually tailored for the target application or runtime. A MySQL database profiler already understands how to instrument queries, and a JVM profiler already can instrument garbage collection. In bpftrace, you need to code such functionality yourself.

It is not necessary to use bpftrace in isolation. The goal is to solve problems, not to use bpftrace exclusively, and sometimes it is fastest to use a combination of these tools.

5.3 BPFTRACE INSTALLATION
bpftrace should be installable via a package for your Linux distribution, but at the time of writing, these packages have only begun to appear; the first bpftrace packages are a snap from Canonical1 and a Debian package2 that will also be available for Ubuntu 19.04. You can also build bpftrace from source. Check INSTALL.md in the bpftrace repository for the latest package and build instructions [63].

1 Thanks to Colin Ian King [61].

2 Thanks to Vincent Bernat [62].

5.3.1 Kernel Requirements
It is recommended that you use a Linux 4.9 kernel (released in December 2016) or newer. The major BPF components that bpftrace uses were added between the 4.1 and 4.9 releases. Improvements have been added in later releases, so the newer your kernel, the better. The BCC documentation includes a list of BPF features by Linux kernel version, which helps explain why later kernels are better (see [64]).

Some kernel configuration options also need to be enabled. These options are now enabled by default in many distributions, so you typically do not need to change them. They are: CONFIG_BPF=y, CONFIG_BPF_SYSCALL=y, CONFIG_BPF_JIT=y, CONFIG_HAVE_EBPF_JIT=y, CONFIG_BPF_EVENTS=y.

5.3.2 Ubuntu
Once the bpftrace package is available for your Ubuntu distribution, installation should be:

Click here to view code image


sudo apt-get update
sudo apt-get install bpftrace

bpftrace can also be built and installed from source:

Click here to view code image


sudo apt-get update
sudo apt-get install bison cmake flex g++ git libelf-dev zlib1g-dev libfl-dev \
  systemtap-sdt-dev llvm-7-dev llvm-7-runtime libclang-7-dev clang-7
git clone https://github.com/iovisor/bpftrace
mkdir bpftrace/build; cd bpftrace/build
cmake -DCMAKE_BUILD_TYPE=Release ..
make
make install

5.3.3 Fedora
Once bpftrace has been packaged, installation should be:

Click here to view code image


sudo dnf install -y bpftrace
bpftrace can also be built from source:

Click here to view code image


sudo dnf install -y bison flex cmake make git gcc-c++ elfutils-libelf-devel \
  zlib-devel llvm-devel clang-devel bcc-devel
git clone https://github.com/iovisor/bpftrace
cd bpftrace
mkdir build; cd build; cmake -DCMAKE_BUILD_TYPE=DEBUG ..
make

5.3.4 Post-Build Steps
To confirm that the build was successful, you can run the test suite and a one-liner as an experiment:

Click here to view code image


sudo ./tests/bpftrace_test
sudo ./src/bpftrace -e 'kprobe:do_nanosleep { printf("sleep by %s\n", comm); }'

Run sudo make install to install the bpftrace binary as /usr/local/bin/bpftrace and the tools in /usr/local/share/bpftrace/tools. You can change the install location by using a cmake(1) option, where -DCMAKE_INSTALL_PREFIX=/usr/local is the default.

5.3.5 Other Distributions
Check for an available bpftrace package, as well as the bpftrace INSTALL.md instructions.

5.4 BPFTRACE TOOLS
Figure 5-2 shows major system components, as well as tools from the bpftrace repository and this book that can observe them.


Figure 5-2 bpftrace performance tools

The current tools in the bpftrace repository are colored black, and the new bpftrace tools from this book are colored differently (red or gray, depending on your version of this book). Some variations are not included here (e.g., the qdisc variants from Chapter 10).

5.4.1 Highlighted Tools
Table 5-1 lists a selection of tools organized by topic. These tools are covered in detail in later chapters.

Table 5-1 Selected bpftrace Tools, by Topic and Chapter

Topic

Highlighted Tools

Chapter(s)

CPU

execsnoop.bt, runqlat.bt, runqlen.bt, cpuwalk.bt, offcputime.bt

6

Memory

oomkill.bt, failts.bt, vmscan.bt, swapin.bt

7

File systems

vfsstat.bt, filelife.bt, xfsdist.bt

8

Storage I/O

biosnoop.bt, biolatency.bt, bitesize.bt, biostacks.bt, scsilatency.bt, nvmelatency.bt

9

Networking

tcpaccept.bt, tcpconnect.bt, tcpdrop.bt, tcpretrans.bt, gethostlatency.bt

10

Security

ttysnoop.bt, elfsnoop.bt, setuids.bt

11

Languages

jnistacks.bt, javacalls.bt

12

Applications

threadsnoop.bt, pmheld.bt, naptime.bt, mysqld_qslower.bt

13

Kernel

mlock.bt, mheld.bt, kmem,bt, kpages.bt, workq.bt

14

Containers

pidnss.bt, blkthrot.bt

15

Hypervisors

xenhyper.bt, cpustolen.bt, kvmexits.bt

16

Debugging / multi-purpose

execsnoop.bt, threadsnoop.bt, opensnoop.bt, killsnoop.bt, signals.bt

6, 8, 13

Note that this book also describes BCC tools that are not listed in Table 5-1.

After reading this chapter, you can jump to later chapters and use this book as a reference guide.

5.4.2 Tool Characteristics
The bpftrace tools have a number of characteristics in common:

They solve real-world observability issues.

They are designed to be run in production environments, as the root user.

There is a man page for every tool (under man/man8).

There is an examples file for every tool, containing output and discussion (under tools/*_examples.txt).

The tool source code begins with a block comment introduction.

The tools are as simple as possible, and short. (More complex tools are deferred to BCC.)

5.4.3 Tool Execution
Bundled tools are executable and can be run immediately as the root user:

Click here to view code image


bpftrace/tools$ ls -lh opensnoop.bt
-rwxr-xr-x 1 bgregg bgregg 1.1K Nov 13 10:56 opensnoop.bt*

bpftrace/tools$ ./opensnoop.bt
ERROR: bpftrace currently only supports running as the root user.

bpftrace/tools$ sudo ./opensnoop.bt
Attaching 5 probes...
Tracing open syscalls... Hit Ctrl-C to end.
PID    COMM               FD ERR PATH
25612  bpftrace           23   0 /dev/null
1458   Xorg              118   0 /proc/18416/cmdline
[...]

These tools can be placed with other system administration tools in an sbin diectory, such as /usr/local/sbin.

5.5 BPFTRACE ONE-LINERS
This section provides a selection of one-liners that are useful both in themselves and to demonstrate the various bpftrace capabilities. The next section explains the programming language, and later chapters introduce more one-liners for specific targets. Note that many of these one-liners summarize data in (kernel) memory and do not print a summary until terminated with Ctrl-C.

Show who is executing what:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_execve { printf("%s -> %s\n", comm,    str(args->filename)); }'
Show new processes with arguments:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_execve { join(args->argv); }'
Show files opened using openat() by process:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm,    str(args->filename)); }'
Count syscalls by program:

Click here to view code image

bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
Count syscallst by syscall probe name:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[probe] = count(); }'
Count syscalls by process:

Click here to view code image

bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[pid, comm] = count(); }'
Show the total read bytes by process:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_exit_read /args->ret/ { @[comm] =    sum(args->ret); }'
Show the read size distribution by process:

Click here to view code image

bpftrace -e 'tracepoint:syscalls:sys_exit_read { @[comm] = hist(args->ret); }'
Show the trace disk I/O size by process:

Click here to view code image

bpftrace -e 'tracepoint:block:block_rq_issue { printf("%d %s %d\n", pid, comm,    args->bytes); }'
Count pages paged in by process:

Click here to view code image

bpftrace -e 'software:major-faults:1 { @[comm] = count(); }'
Count page faults by process:

Click here to view code image

bpftrace -e 'software:faults:1 { @[comm] = count(); }'
Profile user-level stacks at 49 Hertz for PID 189:

Click here to view code image

bpftrace -e 'profile:hz:49 /pid == 189/ { @[ustack] = count(); }'
5.6 BPFTRACE DOCUMENTATION
Each bpftrace tool has an accompanying man page and examples file, just as the tools also do in the BCC project. Chapter 4 discusses the format and intent of these files.

To help people learn to develop new one-liners and tools, I created the “bpftrace One-Liner Tutorial” [65], and the “bpftrace Reference Guide” [66]. These can be found in the /docs directory in the repository.

5.7 BPFTRACE PROGRAMMING
This section provides a short guide to using bpftrace and programming in the bpftrace language. The format of this section was inspired by the original paper for awk [Aho 78], which covered that language in six pages. The bpftrace language itself is inspired by both awk and C, and by tracers including DTrace and SystemTap.

The following is an example of bpftrace programming: It measures the time in the vfs_read() kernel function and prints the time, in microseconds, as a histogram. This summary section explains the components of this tool.

Click here to view code image


#!/usr/local/bin/bpftrace

// this program times vfs_read()

kprobe:vfs_read
{
        @start[tid] = nsecs;
}

kretprobe:vfs_read
/@start[tid]/
{
        $duration_us = (nsecs - @start[tid]) / 1000;
        @us = hist($duration_us);
        delete(@start[tid]);
}

The five sections after this summary cover bpftrace programming in more detail. Those sections are: probes, tests, operators, variables, functions, and map types.

5.7.1 Usage
The command:

Click here to view code image


bpftrace -e program
will execute the program, instrumenting any events it defines. The program will run until Ctrl-C, or until it explicitly calls exit(). A bpftrace program run as a -e argument is termed a one-liner. Alternatively, the program can be saved to a file and executed using:

Click here to view code image


bpftrace file.bt
The .bt extension is not necessary, but helps for later identification. By placing an interpreter line at the top of the file3:

3 Some people prefer using #!/usr/bin/env bpftrace so that bpftrace can be found from the $PATH. However, env(1) comes with various problems, so its usage for the BCC repository was reverted. The bpftrace repository currently uses env(1), but that may be reverted for similar reasons.

Click here to view code image


#!/usr/local/bin/bpftrace
The file can be made executable (chmod a+x file.bt) and run like any other program:

Click here to view code image


./file.bt
bpftrace must be executed by the root user (superuser).4 For some environments, the root shell may be used to execute the program directly, whereas other environments may have a preference for running privileged commands via sudo(1):

4 bpftrace checks for UID 0; a future update may check for specific privileges.

Click here to view code image


sudo ./file.bt

5.7.2 Program Structure
A bpftrace program is a series of probes with associated actions:

Click here to view code image


probes { actions }
probes { actions }
...

When the probes fire, the associated action is executed. An optional filter expression can be included before the action:

Click here to view code image


probes /filter/ { actions }
The action only fires if the filter expression is true. This resembles the awk(1) program structure:

Click here to view code image


/pattern/ { actions }
awk(1) programming is also similar to bpftrace programming: Multiple action blocks can be defined, and they may execute in any order: triggered when their pattern, or probe + filter expression, is true.

5.7.3 Comments
For bpftrace program files, single-line comments can be added with a “//” prefix:

Click here to view code image


// this is a comment
These comments will not be executed. Multi-line comments use the same format as those in C:

Click here to view code image


/*
 * This is a
 * multi-line comment.
 */

This syntax can also be used for partial-line comments (e.g., /* comment */).

5.7.4 Probe Format
A probe begins with a probe type name and then a hierarchy of colon-delimited identifiers:

Click here to view code image


type:identifier1[:identifier2[...]]
The hierarchy is defined by the probe type. Consider these two examples:

Click here to view code image


kprobe:vfs_read
uprobe:/bin/bash:readline

The kprobe probe type instruments kernel function calls, and only needs one identifier: the kernel function name. The uprobe probe type instruments user-level function calls, and needs both the path to the binary and the function name.

Multiple probes can be specified with comma separators to execute the same actions. For example:

Click here to view code image


probe1,probe2,... { actions }
There are two special probe types that require no additional identifiers: BEGIN and END fire for the beginning and the end of the bpftrace program (just like awk(1)).

To learn more about the probe types and their usage, see Section 5.9.

5.7.5 Probe Wildcards
Some probe types accept wildcards. The probe:

Click here to view code image


kprobe:vfs_*
will instrument all kprobes (kernel functions) that begin with “vfs_”.

Instrumenting too many probes may cost unnecessary performance overhead. To avoid hitting this by accident, bpftrace has a tunable maximum number of probes it will enable, set via the BPFTRACE_MAX_PROBES environment variable (it currently defaults to 5125).

5 Currently, having more than 512 probes makes bpftrace slow to start up and shut down, as it instruments them one by one. There is future kernel work planned to batch probe instrumentation. At that point, this limit may be greatly increased or even removed.

You can test your wildcards before using them by running bpftrace -l:

Click here to view code image


# bpftrace -l 'kprobe:vfs_*'
kprobe:vfs_fallocate
kprobe:vfs_truncate
kprobe:vfs_open
kprobe:vfs_setpos
kprobe:vfs_llseek
[...]
bpftrace -l 'kprobe:vfs_*' | wc -l
56

This matched 56 probes. The probe name is in quotes to prevent unintended shell expansion.

5.7.6 Filters
Filters are Boolean expressions that gate whether an action is executed. The filter

Click here to view code image


/pid == 123/
will execute the action only if the pid built-in (process ID) is equal to 123.

If a test is not specified:

Click here to view code image


/pid/
the filter will check that the contents are non-zero (/pid/ is the same as /pid != 0/). Filters can be combined with Boolean operators, such as logical AND (&&). For example:

Click here to view code image


/pid > 100 && pid < 1000/
This requires that both expressions evaluate to “true.”

5.7.7 Actions
An action can be a single statement or multiple statements separated by semicolons:

Click here to view code image


{ action one; action two; action three }
The final statement may also have a semicolon appended. The statements are written in the bpftrace language, which is similar to the C language, and can manipulate variables and execute bpftrace function calls. For example, the action

Click here to view code image


{ $x = 42; printf("$x is %d", $x); }
sets a variable, $x, to 42, and then prints it using printf(). Sections 5.7.9 and 5.7.11 summarize other available function calls.

5.7.8 Hello, World!
You should now understand the following basic program, which prints “Hello, World!” when bpftrace begins running:

Click here to view code image


# bpftrace -e 'BEGIN { printf("Hello, World!\n"); }'
Attaching 1 probe...
Hello, World!
^C

As a file, it could be formatted as:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Hello, World!\n");
}

Spanning multiple lines with an indented action block is not necessary, but it improves readability.

5.7.9 Functions
In addition to printf() for printing formatted output, other built-in functions include:

exit(): Exits bpftrace

str(char *): Returns a string from a pointer

system(format[, arguments ...]): Runs a command at the shell

The following action:

Click here to view code image


printf("got: %llx %s\n", $x, str($x)); exit();
will print the $x variable as a hex integer, and then treat it as a NULL-terminated character array pointer (char *) and print it as a string, and then exit.

5.7.10 Variables
There are three variable types: built-ins, scratch, and maps.

Built-in variables are pre-defined and provided by bpftrace, and are usually read-only sources of information. They include pid for the process id, comm for the process name, nsecs for a timestamp in nanoseconds, and curtask for the address of the current thread’s task_struct.

Scratch variables can be used for temporary calculations and have the prefix “$”. Their name and type is set on their first assignment. The statements:

Click here to view code image


$x = 1;
$y = "hello";
$z = (struct task_struct *)curtask;

declare $x as an integer, $y as a string, and $z as a pointer to a struct task_struct. These variables can only be used in the action block in which they were assigned. If variables are referenced without an assignment, bpftrace errors (which can help you catch typos).

Map variables use the BPF map storage object and have the prefix “@”. They can be used for global storage, passing data between actions. The program

Click here to view code image


probe1 { @a = 1; }
probe2 { $x = @a; }

Assigns 1 to @a when probe1 fires, then assigns @a to $x when probe2 fires. If probe1 fired first and then probe2, $x would be set to 1; otherwise 0 (uninitialized).

A key can be provided with one or more elements, using maps as a hash table (an associative array). The statement:

Click here to view code image


@start[tid] = nsecs;
is frequently used: the nsecs built-in is assigned to a map named @start and keyed on tid, the current thread ID. This allows threads to store custom timestamps that won’t be overwritten by other threads.

Click here to view code image


@path[pid, $fd] = str(arg0);
is an example of a multi-key map, one using both the pid builtin and the $fd variable as keys.

5.7.11 Map Functions
Maps can be assigned to special functions. These functions store and print data in custom ways. The assignment

Click here to view code image


@x = count();
counts events, and when printed will print the count. This uses a per-CPU map, and @x becomes a special object of type count. The following statement also counts events:

Click here to view code image


@x++;
However, this uses a global CPU map, instead of a per-CPU map, to provide @x as an integer. This global integer type is sometimes necessary for some programs that require an integer and not a count, but bear in mind that there may be a small error margin due to concurrent updates (see Section 2.3.7 in Chapter 2).

The assignment

Click here to view code image


@y = sum($x);
sums the $x variable, and when printed will print the total. The assignment

Click here to view code image


@z = hist($x);
stores $x in a power-of-two histogram, and when printed will print bucket counts and an ASCII histogram.

Some map functions operate directly on a map. For example:

Click here to view code image


print(@x);
will print the @x map. This is not used often because, for convenience, all maps are automatically printed when bpftrace terminates.

Some map functions operate on a map key. For example:

Click here to view code image


delete(@start[tid]);
deletes the key-value pair from the @start map where the key is tid.

5.7.12 Timing vfs_read()
You have now learned the syntax needed to understand a more involved and practical example. This program, vfsread.bt, times the vfs_read kernel function and prints out a histogram of its duration in microseconds (us):

Click here to view code image


#!/usr/local/bin/bpftrace

// this program times vfs_read()

kprobe:vfs_read
{
        @start[tid] = nsecs;
}

kretprobe:vfs_read
/@start[tid]/
{
        $duration_us = (nsecs - @start[tid]) / 1000;
        @us = hist($duration_us);
        delete(@start[tid]);
}

This times the duration of the vfs_read() kernel function by instrumenting its start using a kprobe and storing a timestamp in a @start hash keyed on thread ID, and then instrumenting its end by using a kretprobe and calculating the delta as: now - start. A filter is used to ensure that the start time was recorded; otherwise, the delta calculation becomes bogus: now - 0.

Sample output:

Click here to view code image


# bpftrace vfsread.bt
Attaching 2 probes...
^C
@us:
[0]                   23 |@                                                   |
[1]                  138 |@@@@@@@@@                                           |
[2, 4)               538 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@               |
[4, 8)               744 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[8, 16)              641 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        |
[16, 32)             122 |@@@@@@@@                                            |
[32, 64)              13 |                                                    |
[64, 128)             17 |@                                                   |
[128, 256)             2 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)              1 |                                                    |

The program ran until Ctrl-C was entered, then it printed this output and terminated. This histogram map was named “us” as a way to include units with the output, since the map name is printed out. By giving maps meaningful names like “bytes” and “latency_ns” you can annotate the output and make it self-explanatory.

This script can be customized as needed. Consider changing the hist() assignment line to:

Click here to view code image


@us[pid, comm] = hist($duration_us);
That stores one histogram per process ID and process name pair. The output becomes:

Click here to view code image


# bpftrace vfsread.bt
Attaching 2 probes...
^C

@us[1847, gdbus]:
[1]                    2 |@@@@@@@@@@                                          |
[2, 4)                10 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)                10 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@us[1630, ibus-daemon]:
[2, 4)                 9 |@@@@@@@@@@@@@@@@@@@@@@@@@@@                         |
[4, 8)                17 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@us[29588, device poll]:
[1]                   13 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@       |
[2, 4)                15 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)                 4 |@@@@@@@@@@@@@                                       |
[8, 16)                4 |@@@@@@@@@@@@@                                       |
[...]

This illustrates one of the most useful capabilities of bpftrace. With traditional system tools, like iostat(1) and vmstat(1), the output is fixed and cannot be easily customized. But with bpftrace, the metrics you see can be further broken down into parts and enhanced with metrics from other probes until you have the answers you need.

5.8 BPFTRACE USAGE
With no arguments (or -h), the bpftrace USAGE message is printed, which summarizes important options and environment variables and lists some example one-liners:

Click here to view code image


# bpftrace
USAGE:
    bpftrace [options] filename
    bpftrace [options] -e 'program'

OPTIONS:
    -B MODE        output buffering mode ('line', 'full', or 'none')
    -d             debug info dry run
    -o file        redirect program output to file
    -dd            verbose debug info dry run
    -e 'program'   execute this program
    -h, --help     show this help message
    -I DIR         add the directory to the include search path
    --include FILE add an #include file before preprocessing
    -l [search]    list probes
    -p PID         enable USDT probes on PID
    -c 'CMD'       run CMD and enable USDT probes on resulting process
    --unsafe       allow unsafe builtin functions
    -v             verbose messages
    -V, --version  bpftrace version

ENVIRONMENT:
    BPFTRACE_STRLEN           [default: 64] bytes on BPF stack per str()
    BPFTRACE_NO_CPP_DEMANGLE  [default: 0] disable C++ symbol demangling
    BPFTRACE_MAP_KEYS_MAX     [default: 4096] max keys in a map
    BPFTRACE_CAT_BYTES_MAX    [default: 10k] maximum bytes read by cat builtin
    BPFTRACE_MAX_PROBES       [default: 512] max number of probes

EXAMPLES:
bpftrace -l '*sleep*'
    list probes containing "sleep"
bpftrace -e 'kprobe:do_nanosleep { printf("PID %d sleeping...\n", pid); }'
    trace processes calling sleep
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
    count syscalls by process name

This output is from bpftrace version v0.9-232-g60e6, 15-Jun-2019. As more features are added this USAGE message may become unwieldy, and a short and a long version may be added. Check the output for your current version to see if this is the case.

5.9 BPFTRACE PROBE TYPES
Table 5-2 lists available probe types. Many of these also have a shortcut alias, which help create shorter one-liners.

Table 5-2 bpftrace Probe Types

Type

Shortcut

Description

tracepoint

t

Kernel static instrumentation points

usdt

U

User-level statically defined tracing

kprobe

k

Kernel dynamic function instrumentation

kretprobe

kr

Kernel dynamic function return instrumentation

uprobe

u

User-level dynamic function instrumentation

uretprobe

ur

User-level dynamic function return instrumentation

software

s

Kernel software-based events

hardware

h

Hardware counter-based instrumentation

profile

p

Timed sampling across all CPUs

interval

i

Timed reporting (from one CPU)

BEGIN

Start of bpftrace

END

End of bpftrace

These probe types are interfaces to existing kernel technologies. Chapter 2 explains how these technologies work: kprobes, uprobes, tracepoints, USDT, and PMCs (used by the hardware probe type).

Some probes may fire frequently, such as for scheduler events, memory allocations, and network packets. To reduce overhead, try to solve your problems by using less-frequent events wherever possible. See Chapter 18 for a discussion on minimizing overhead that applies to both BCC and bpftrace development.

The following sections summarize bpftrace probe usage.

5.9.1 tracepoint
The tracepoint probe type instruments tracepoints: kernel static instrumentation points. Format:

Click here to view code image


tracepoint:tracepoint_name

The tracepoint_name is the full name of the tracepoint, including the colon, which separates the tracepoint into its own hierarchy of class and event name. For example, the tracepoint net:netif_rx can be instrumented in bpftrace with the probe tracepoint:net:netif_rx.

Tracepoints usually provide arguments: these are fields of information that can be accessed in bpftrace via the args built-in. For example, net:netif_rx has a field called len for the packet length that can accessed using args->len.

If you’re new to bpftrace and tracing, system call tracepoints are good targets to instrument. They provide broad coverage of kernel resource usage and have a well-documented API: the syscall man pages. For example, the tracepoints:

Click here to view code image


syscalls:sys_enter_read
syscalls:sys_exit_read

instrument the start and end of the read(2) system call. The man page has its signature:

Click here to view code image


ssize_t read(int fd, void *buf, size_t count);
For the sys_enter_read tracepoint, its arguments should be available as args->fd, args->buf, and args->count. This can be checked using the -l (list) and -v (verbose) modes of bpftrace:

Click here to view code image


# bpftrace -lv tracepoint:syscalls:sys_enter_read
tracepoint:syscalls:sys_enter_read
    int __syscall_nr;
    unsigned int fd;
    char * buf;
    size_t count;

The man page also describes what these arguments are and the return value of the read(2) syscall, which can be instrumented using the sys_exit_read tracepoint. This tracepoint has an additional argument not found in the man page, __syscall_nr, for the syscall number.

As an interesting tracepoint example, I will trace the enter and exit of the clone(2) syscall, which creates new processes (similar to fork(2)). For these events, I will print the current process name and PID using bpftrace built-in variables. For the exit, I will also print the return value using a tracepoint argument:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_enter_clone {
    printf("-> clone() by %s PID %d\n", comm, pid); }
  tracepoint:syscalls:sys_exit_clone {
    printf("<- clone() return %d, %s PID %d\n", args->ret, comm, pid); }'
Attaching 2 probes...
-> clone() by bash PID 2582
<- clone() return 27804, bash PID 2582
<- clone() return 0, bash PID 27804

This syscall is unusual in that it has one entry and two exits! While tracing, I ran ls(1) in a bash(1) terminal. The parent process (PID 2582) can be seen to enter clone(2), and then there are two returns: one for the parent that returns the child PID (27804), and one for the child that returns zero (success). When the child begins, it is still “bash” as it has not yet executed an exec(2) family syscall to become “ls”. That can be traced as well:

Click here to view code image


# bpftrace -e 't:syscalls:sys_*_execve { printf("%s %s PID %d\n", probe, comm,
    pid); }'
Attaching 2 probes...
tracepoint:syscalls:sys_enter_execve bash PID 28181
tracepoint:syscalls:sys_exit_execve ls PID 28181

This output shows PID 28181 enter the execve(2) syscall as “bash”, and then exiting as “ls”.

5.9.2 usdt
This probe type instruments user-level static instrumentation points. Format:

Click here to view code image


usdt:binary_path:probe_name
usdt:library_path:probe_name
usdt:binary_path:probe_namespace:probe_name
usdt:library_path:probe_namespace:probe_name

usdt can instrument executable binaries or shared libraries by providing the full path. The probe_name is the USDT probe name from the binary. For example, a probe named query__start in MySQL server may be accessible (depending on the installed path) as usdt:/usr/local/sbin/mysqld:query__start.

When a probe namespace is not specified, it defaults to the same name as the binary or library. There are many probes for which it differs, and the namespace must be included. One example is the “hotspot” namespace probes from libjvm (the JVM library). For example (full library path truncated):

Click here to view code image


usdt:/.../libjvm.so:hotspot:method__entry
Any arguments to the USDT probe are available as members of the args built-in.

The available probes in a binary can be listed using -l, for example:

Click here to view code image


# bpftrace -l 'usdt:/usr/local/cpython/python'
usdt:/usr/local/cpython/python:line
usdt:/usr/local/cpython/python:function__entry
usdt:/usr/local/cpython/python:function__return
usdt:/usr/local/cpython/python:import__find__load__start
usdt:/usr/local/cpython/python:import__find__load__done
usdt:/usr/local/cpython/python:gc__start
usdt:/sur/local/cpython/python:gc__done

Instead of providing a probe description, you can use -p PID instead to list the USDT probes in a running process.

5.9.3 kprobe and kretprobe
These probe types are for kernel dynamic instrumentation. Format:

Click here to view code image


kprobe:function_name
kretprobe:function_name

kprobe instruments the start of the function (its entry), and kretprobe instruments the end (its return). The function_name is the kernel function name. For example, the vfs_read() kernel function can be instrumented using kprobe:vfs_read and kretprobe:vfs_read.

Arguments for kprobe: arg0, arg1, …, argN are the entry arguments to the function, as unsigned 64-bit integers. If they are a pointer to a C struct, they can be cast to that struct.6 The future BPF type format (BTF) technology may make this automatic (see Chapter 2).

6 This is C terminology that refers to changing the type of an object in a program. For an example, see the bpftrace source to runqlen(8) in Chapter 6.

Arguments for kretprobe: the retval built-in has the return value of the function. retval is always uint64; if this does not match the return type for the function, it needs to be cast to that type.

5.9.4 uprobe and uretprobe
These probe types are for user-level dynamic instrumentation. Format:

Click here to view code image


uprobe:binary_path:function_name
uprobe:library_path:function_name
uretprobe:binary_path:function_name
uretprobe:library_path:function_name

uprobe instruments the start of the function (its entry), and uretprobe instruments the end (its return). The function_name is the function name. For example, the readline() function in /bin/bash can be instrumented using uprobe:/bin/bash:readline and uretprobe:/bin/bash:readline.

Arguments for uprobe: arg0, arg1, …, argN are the entry arguments to the function, as unsigned 64-bit integers. They can be cast to their struct types.7

7 It’s possible that BTF may be provided as user-level software in the future, so that binaries can self-describe their struct types similarly to kernel BTF.

Arguments for uretprobe: the retval built-in has the return value of the function. retval is always uint64, and it needs to be cast to match the real return type.

5.9.5 software and hardware
These probe types are for predefined software and hardware events. Format:

Click here to view code image


software:event_name:count
software:event_name:
hardware:event_name:count
hardware:event_name:

Software events are similar to tracepoints but are suited for count-based metrics and sample-based instrumentation. Hardware events are a selection of PMCs for processor-level analysis.

Both event types may occur so frequently that instrumenting every event can incur significant overhead, degrading system performance. This is avoided by using sampling and the count field, which triggers the probe to fire once every [count] events. If a count is not provided, a default is used. For example, the probe software:page-faults:100 will only fire for one in every 100 page faults.

The available software events, which depend on the kernel version, are shown in Table 5-3.

Table 5-3 Software Events

Software Event Name

Alias

Default Sample Count

Description

cpu-clock

cpu

1000000

CPU wall-time clock

task-clock

1000000

CPU task clock (increments only when task is on-CPU)

page-faults

faults

100

Page faults

context-switches

cs

1000

Context switches

cpu-migrations

1

CPU thread migrations

minor-faults

100

Minor page faults: satisfied by memory

major-faults

1

Major page faults: satisfied by storage I/O

alignment-faults

1

Alignment faults

emulation-faults

1

Emulation faults

dummy

1

Dummy event for testing

bpf-output

1

BPF output channel

The available hardware events, which depend on the kernel version and processor type, are listed in Table 5-4.

Table 5-4 Hardware Events

Hardware Event Name

Alias

Default Sample Count

Description

cpu-cycles

cycles

1000000

CPU clock cycles

instructions

1000000

CPU instructions

cache-references

1000000

CPU last level cache references

cache-misses

1000000

CPU last level cache misses

branch-instructions

branches

100000

Branch instructions

bus-cycles

100000

Bus cycles

frontend-stalls

1000000

Processor frontend stalls (e.g., instruction fetches)

backend-stalls

1000000

Processor backend stalls (e.g., data loads/stores)

ref-cycles

1000000

CPU reference cycles (unscaled by turbo)

The hardware events occur more frequently, so higher default sample counts are used.

5.9.6 profile and interval
These probe types are timer-based events. Format:

Click here to view code image


profile:hz:rate
profile:s:rate
profile:ms:rate
profile:us:rate
interval:s:rate
interval:ms:rate

The profile type fires on all CPUs and can be used for sampling CPU usage. The interval type only fires on one CPU and can be used to print interval-based output.

The second field is the units for the last field, rate. This field may be:

hz: Hertz (events per second)

s: Seconds

ms: Milliseconds

us: Microseconds

For example, the probe profile:hz:99 fires 99 times per second, across all CPUs. A a rate of 99 is often used instead of 100 to avoid issues of lockstep sampling. The probe interval:s:1 fires once per second and can be used to print per-second output.

5.10 BPFTRACE FLOW CONTROL
There are three types of tests in bpftrace: filters, ternary operators, and if statements. These tests conditionally change the flow of the program based on Boolean expressions, which support:

==: Equal to

!=: Not equal to

>: Greater than

<: Less than

>=: Greater than or equal to

<=: Less than or equal to

&&: And

||: Or

Expressions may be grouped using parentheses.

There is limited support for loops because, for safety, the BPF verifier rejects any code that might trigger an infinite loop. bpftrace supports unrolled loops, and a future version should support bounded loops.

5.10.1 Filter
Introduced earlier, these gate whether an action is executed. Format:

Click here to view code image


probe /filter/ { action }
Boolean operators may be used. The filter /pid == 123/ only executes the action if the pid built-in equals 123.

5.10.2 Ternary Operators
A ternary operator is a three-element operator composed of a test and two outcomes. Format:

Click here to view code image


test ? true_statement : false_statement
As an example, you can use a ternary operator to find the absolute value of $x:

Click here to view code image


$abs = $x >= 0 ? $x : - $x;
5.10.3 If Statements
If statements have the following syntax:

Click here to view code image


if (test) { true_statements }
if (test) { true_statements } else { false_statements }

One use case is with programs that perform different actions on IPv4 than on IPv6. For example:

Click here to view code image


if ($inet_family == $AF_INET) {
    // IPv4
    ...
} else {
    // IPv6
    ...
}

“else if” statements are not currently supported.

5.10.4 Unrolled Loops
BPF runs in a restricted environment where it must be possible to verify that a program ends and does not get stuck in an infinite loop. For programs that need some loop functionality, bpftrace supports unrolled loops with unroll().

Syntax:

Click here to view code image


unroll (count) { statements }
The count is an integer literal (constant) with a maximum of 20. Providing the count as a variable is not supported, as the number of loop iterations must be known in the BPF compile stage.

The Linux 5.3 kernel included support for BPF bounded loops. Future versions of bpftrace should support this capability, such as by providing for and while loops, in addition to unroll.

5.11 BPFTRACE OPERATORS
The previous section listed Boolean operators for use in tests. bpftrace also supports the following operators:

=: Assignment

+, -, *, /: Addition, subtraction, multiplication, division

++, --: Auto-increment, auto-decrement

&, |, ^: Binary and, binary or, binary exclusive or

!: Logical not

<<, >>: Shift left, shift right

+=, -=, *=, /=, %=, &=, ^=, <<=, >>=: Compound operators

These operators were modeled after similar operators in the C programming language.

5.12 BPFTRACE VARIABLES
As introduced in Section 5.7.10, there are three variable types: built-in, scratch, and map variables.

5.12.1 Built-in Variables
The built-in variables provided by bpftrace are usually for read-only access of information. The most important built-in variables are listed in Table 5-5.

Table 5-5 bpftrace Selected Built-in Variables

Built-in Variable

Type

Description

pid

integer

Process ID (kernel tgid)

tid

integer

Thread ID (kernel pid)

uid

integer

User ID

username

string

Username

nsecs

integer

Timestamp, in nanoseconds

elapsed

integer

Timestamp, in nanoseconds, since bpftrace initialization

cpu

integer

Processor ID

comm

string

Process name

kstack

string

Kernel stack trace

ustack

string

User-level stack trace

arg0, ..., argN

integer

Arguments to some probe types (see Section 5.9)

args

struct

Arguments to some probe types (see Section 5.9)

retval

integer

Return value for some probe types (see Section 5.9)

func

string

Name of the traced function

probe

string

Full name of the current probe

curtask

integer

Kernel task_struct as a unsigned 64-bit integer (can be cast)

cgroup

integer

Cgroup ID

$1, ..., $N

int, char *

Positional parameters for the bpftrace program

All integers are currently uint64. These variables all refer to the currently running thread, probe, function, and CPU when the probe fires. See the online “bpftrace Reference Guide” for the full and updated list of built-in variables [66].

5.12.2 Built-ins: pid, comm, and uid
Many built-ins are straightforward to use. This example uses pid, comm, and uid to print who is calling the setuid() syscall:

Click here to view code image


# bpftrace -e 't:syscalls:sys_enter_setuid {
    printf("setuid by PID %d (%s), UID %d\n", pid, comm, uid); }'
Attaching 1 probe...
setuid by PID 3907 (sudo), UID 1000
setuid by PID 14593 (evil), UID 33
^C

Just because a syscall was called doesn’t mean it was successful. You can trace the return value by using a different tracepoint:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_setuid {
    printf("setuid by %s returned %d\n", comm, args->ret); }'
Attaching 1 probe...
setuid by sudo returned 0
setuid by evil returned -1
^C

This uses another built-in, args. For tracepoints, args is a struct type that provides custom fields.

5.12.3 Built-ins: kstack and ustack
kstack and ustack return kernel- and user-level stack traces as a multi-line string. They return up to 127 frames of stack trace. The kstack() and ustack() functions, covered later, allow you to select the number of frames.

For example, printing kernel stack traces on block I/O insert using kstack:

Click here to view code image


# bpftrace -e 't:block:block_rq_insert { printf("Block I/O by %s\n", kstack); }'
Attaching 1 probe...

Block I/O by
        blk_mq_insert_requests+203
        blk_mq_sched_insert_requests+111
        blk_mq_flush_plug_list+446
        blk_flush_plug_list+234
        blk_finish_plug+44
        dmcrypt_write+593
        kthread+289
        ret_from_fork+53

Block I/O by
        blk_mq_insert_requests+203
        blk_mq_sched_insert_requests+111
        blk_mq_flush_plug_list+446
        blk_flush_plug_list+234
        blk_finish_plug+44
        __do_page_cache_readahead+474
        ondemand_readahead+282
        page_cache_sync_readahead+46
        generic_file_read_iter+2043
        ext4_file_read_iter+86
        new_sync_read+228
        __vfs_read+41
        vfs_read+142
        kernel_read+49
        prepare_binprm+239
        do_execveat_common.isra.34+1428
        sys_execve+49
        do_syscall_64+115
        entry_SYSCALL_64_after_hwframe+61
[...]

Each stack trace is printed with frames in child-to-parent order and with each frame as the function name + function offset.

The stack built-ins can also be used as keys in maps, allowing them to be frequency counted. For example, counting kernel stacks that led to block I/O:

Click here to view code image


# bpftrace -e 't:block:block_rq_insert { @[kstack] = count(); }'
Attaching 1 probe...
^C
[...]
@[
    blk_mq_insert_requests+203
    blk_mq_sched_insert_requests+111
    blk_mq_flush_plug_list+446
    blk_flush_plug_list+234
    blk_finish_plug+44
    dmcrypt_write+593
    kthread+289
    ret_from_fork+53
]: 39
@[
    blk_mq_insert_requests+203
    blk_mq_sched_insert_requests+111
    blk_mq_flush_plug_list+446
    blk_flush_plug_list+234
    blk_finish_plug+44
    __do_page_cache_readahead+474
    ondemand_readahead+282
    page_cache_sync_readahead+46
    generic_file_read_iter+2043
    ext4_file_read_iter+86
    new_sync_read+228
    __vfs_read+41
    vfs_read+142
    sys_read+85
    do_syscall_64+115
    entry_SYSCALL_64_after_hwframe+61
]: 52

Only the last two stacks are shown here, with counts of 39 and 52. Counting is more efficient than printing out each stack, as the stack traces are counted in kernel context for efficiency.8

8 BPF turns each stack into a unique stack ID and then frequency counts the IDs. bpftrace reads these frequency counts and then fetches the stacks for each ID.

5.12.4 Built-ins: Positional Parameters
Positional parameters are passed to the program on the command line, and are based on positional parameters used in shell scripting. $1 refers to the first argument, $2 the second, and so on.

For example, the simple program watchconn.bt:

Click here to view code image


BEGIN
{
        printf("Watching connect() calls by PID %d\n", $1);
}

tracepoint:syscalls:sys_enter_connect
/pid == $1/
{
        printf("PID %d called connect()\n", $1);
}

watches the PID passed in on the command line:

Click here to view code image


# ./watchconn.bt 181
Attaching 2 probes...
Watching connect() calls by PID 181
PID 181 called connect()
[...]

These positional parameters also work with these invocation types:

Click here to view code image


bpftrace ./watchconn.bt 181
bpftrace -e 'program' 181

They are integers by default. If a string is used as an argument, it must be accessed via a str() call. For example:

Click here to view code image


# bpftrace -e 'BEGIN { printf("Hello, %s!\n", str($1)); }' Reader
Attaching 1 probe...
Hello, Reader!
^C

If a parameter that is accessed is not provided at the command line, it is zero in integer context, or “” if accessed via str().

5.12.5 Scratch
Format:

Click here to view code image


$name
These variables can be used for temporary calculations within an action clause. Their type is determined on first assignment, and they can be integers, strings, struct pointers, or structs.

5.12.6 Maps
Format:

Click here to view code image


@name
@name[key]
@name[key1, key2[, ...]]

For storage, these variables use the BPF map object, which is a hash table (associative array) that can be used for different storage types. Values can be stored using one or more keys. Maps must have consistent key and value types.

As with scratch variables, the type is determined upon first assignment, which includes assignment to special functions. With maps, the type includes the keys, if present, as well as the value. For example, consider these first assignments:

Click here to view code image


@start = nsecs;
@last[tid] = nsecs;
@bytes = hist(retval);
@who[pid, comm] = count();

Both the @start and @last maps become integer types because an integer is assigned to them: the nanosecond timestamp built-in (nsecs). The @last map also requires a key of type integer because it uses an integer key: the thread ID (tid). The @bytes map becomes a special type, a power-of-two histogram, which handles storage and the printing of the histogram. Finally, the @who map has two keys, integer (pid) and string (comm), and the value is the count() map function.

These functions are covered in Section 5.14.

5.13 BPFTRACE FUNCTIONS
bpftrace provides built-in functions for various tasks. The most important of them are listed in Table 5-6.

Table 5-6 bpftrace Selected Built-in Functions

Function

Description

printf(char *fmt [, ...])

Prints formatted

time(char *fmt)

Prints formatted time

join(char *arr[])

Prints the array of strings, joined by a space character

str(char *s [, int len])

Returns the string from the pointer s, with an optional length limit

kstack(int limit)

Returns a kernel stack up to limit frames deep

ustack(int limit)

Returns a user stack up to limit frames deep

ksym(void *p)

Resolves the kernel address and returns the string symbol

usym(void *p)

Resolves the user-space address and returns the string symbol

kaddr(char *name)

Resolves the kernel symbol name to an address

uaddr(char *name)

Resolves the user-space symbol name to an address

reg(char *name)

Returns the value stored in the named register

ntop([int af,] int addr)

Returns a string representation of an IP address

system(char *fmt [, ...])

Executes a shell command

cat(char *filename)

Prints the contents of a file

exit()

Exits bpftrace

Some of these functions are asynchronous: The kernel queues the event, and a short time later it is processed in user space. The asynchronous functions are printf(), time(), cat(), join(), and system(). kstack(), ustack(), ksym(), and usym() record addresses synchronously, but they do symbol translation asynchronously.

See the online “bpftrace Reference Guide” for the full and updated list of functions [66]. A selection of these functions are discussed in the following sections.

5.13.1 printf()
The printf() call, short for print formatted, behaves as it does in C and other languages. Syntax:

Click here to view code image


printf(format [, arguments ...])
The format string can contain any text message, as well as escape sequences beginning with ‘\’, and field descriptions beginning with ‘%’. If no arguments are given, no field descriptions are required.

Commonly used escape sequences are:

\n: New line

\": Double quote

\\: Backslash

See the printf(1) man page for other escape sequences.

Field descriptions begin with ‘%’, and have the format:

Click here to view code image


% [-] width type
The ‘-’ sets the output to be left-justified. The default is right-justified.

The width is the number of characters that the field is wide.

The type is either:

%u, %d: Unsigned int, int

%lu, %ld: Unsigned long, long

%llu, %lld: Unsigned long long, long long

%hu, %hd: Unsigned short, short

%x, %lx, %llx: Hexadecimal: unsigned int, unsigned long, unsigned long long

%c: Character

%s: String

This printf() call:

Click here to view code image


printf("%16s %-6d\n", comm, pid)
prints the comm built-in as a 16-character-wide string field, right-justified, and the pid built-in as a six-character-wide integer field, left-justified, followed by a new line.

5.13.2 join()
join() is a special function for joining an array of strings with a space character and printing them out. Syntax:

Click here to view code image


join(char *arr[])
For example, this one-liner shows attempted execution of commands with their arguments:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_enter_execve { join(args->argv); }'
Attaching 1 probe...
ls -l
df -h
date
ls -l bashreadline.bt biolatency.bt biosnoop.bt bitesize.bt

It prints the argv array argument to the execve() syscall. Note that this is showing attempted execution: The syscalls:sys_exit_execve tracepoint and its args->ret value show whether the syscall succeeded.

join() may be a handy function in some circumstances, but it has limitations on the number of arguments it can join, and their size.9 If the output appears truncated, it is likely that you have hit these limits and need to use a different approach.

9 The current limits are 16 arguments and a size of 1 Kbyte each. It prints out all arguments until it reaches one that is NULL or hits the 16-argument limit.

There has been work to change the behavior of join() to make it return a string rather than print one out. This would change the previous bpftrace one-liner to be:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_enter_execve {
    printf("%s\n", join(args->argv); }'

This change would also make join() no longer be an asynchronous function.10

10 See bpftrace issue 26 for the status of this change [67]. It has not been a priority to do, since so far join() has only had one use case: joining args->argv for the execve syscall tracepoint.

5.13.3 str()
str() returns the string from a pointer (char *). Syntax:

Click here to view code image


str(char *s [, int length])
For example, the return value from the bash(1) shell readline() function is a string and can be printed using11:

11 This assumes that readline() is in the bash(1) binary; some builds of bash(1) may call it from libreadline instead, and this one-liner will need to be modified to match. See Section 12.2.3 in Chapter 12.

Click here to view code image


# bpftrace -e 'ur:/bin/bash:readline { printf("%s\n", str(retval)); }'
Attaching 1 probe...
ls -lh
date
echo hello BPF
^C

This one-liner can show all bash interactive commands system-wide.

By default, the string has a size limit of 64 bytes, which can be tuned using the bpftrace environment variable BPFTRACE_STRLEN. Sizes over 200 bytes are not currently allowed; this is a known limitation, and one day the limit may be greatly increased.12

12 This is tracked by bpftrace issue 305 [68]. The problem is that string storage currently uses the BPF stack, which is limited to 512 bytes and hence has a low string limit (200 bytes). String storage should be changed to use a BPF map, at which point very large strings (Mbytes) should be possible.

5.13.4 kstack() and ustack()
kstack() and ustack() are similar to the kstack and ustack built-ins, but they accept a limit argument and an optional mode argument. Syntax:

Click here to view code image


kstack(limit)
kstack(mode[, limit])
ustack(limit)
ustack(mode[, limit])

For example, showing the top three kernel frames that led to creating block I/O, by tracing the block:block_rq_insert tracepoint:

Click here to view code image


# bpftrace -e 't:block:block_rq_insert { @[kstack(3), comm] = count(); }'
Attaching 1 probe...
^C

@[
    __elv_add_request+231
    blk_execute_rq_nowait+160
    blk_execute_rq+80
, kworker/u16:3]: 2
@[
    blk_mq_insert_requests+203
    blk_mq_sched_insert_requests+111
    blk_mq_flush_plug_list+446
, mysqld]: 2
@[
    blk_mq_insert_requests+203
    blk_mq_sched_insert_requests+111
    blk_mq_flush_plug_list+446
, dmcrypt_write]: 961

The current maximum stack size allowed is 1024 frames.

The mode argument allows the stack output to be formatted differently. Only two modes are currently supported: “bpftrace”, the default; and “perf”, which produces a stack format similar to that of the Linux perf(1) utility. For example:

Click here to view code image


# bpftrace -e 'k:do_nanosleep { printf("%s", ustack(perf)); }'
Attaching 1 probe...
[...]
        7f220f1f2c60 nanosleep+64 (/lib/x86_64-linux-gnu/libpthread-2.27.so)
        7f220f653fdd g_timeout_add_full+77 (/usr/lib/x86_64-linux-gnu/libglib-
2.0.so.0.5600.3)
        7f220f64fbc0 0x7f220f64fbc0 ([unknown])
        841f0f 0x841f0f ([unknown])

Other modes may be supported in the future.

5.13.5 ksym() and usym()
The ksym() and usym() functions resolve addresses into their symbol names (strings). ksym() is for kernel addresses, and usym() is for user-space addresses. Syntax:

Click here to view code image


ksym(addr)
usym(addr)

For example, the timer:hrtimer_start tracepoint has a function pointer argument. Frequency counts:

Click here to view code image


# bpftrace -e 'tracepoint:timer:hrtimer_start { @[args->function] = count(); }'
Attaching 1 probe...
^C

@[-1169374160]: 3
@[-1168782560]: 8
@[-1167295376]: 9
@[-1067171840]: 145
@[-1169062880]: 200
@[-1169114960]: 2517
@[-1169048384]: 8237

These are raw addresses. Using ksym() to convert these to kernel function names:

Click here to view code image


# bpftrace -e 'tracepoint:timer:hrtimer_start { @[ksym(args->function)] = count(); }'
Attaching 1 probe...
^C

@[sched_rt_period_timer]: 4
@[watchdog_timer_fn]: 8
@[timerfd_tmrproc]: 15
@[intel_uncore_fw_release_timer]: 1111
@[it_real_fn]: 2269
@[hrtimer_wakeup]: 7714
@[tick_sched_timer]: 27092

usym() relies on symbol tables in the binary for symbol lookup.

5.13.6 kaddr() and uaddr()
kaddr() and uaddr() take a symbol name and return the address. kaddr() is for kernel symbols, and uaddr() is for user-space symbols. Syntax:

Click here to view code image


kaddr(char *name)
uaddr(char *name)

For example, looking up the user-space symbol “ps1_prompt” when a bash(1) shell function is called, and then dereferencing it and printing it as a string:

Click here to view code image


# bpftrace -e 'uprobe:/bin/bash:readline {
    printf("PS1: %s\n", str(*uaddr("ps1_prompt"))); }'
Attaching 1 probe...
PS1: \[\e[34;1m\]\u@\h:\w>\[\e[0m\]
PS1: \[\e[34;1m\]\u@\h:\w>\[\e[0m\]
^C

This is printing the contents of the symbol—in this case the bash(1) PS1 prompt.

5.13.7 system()
system() executes a command at the shell. Syntax:

Click here to view code image


system(char *fmt [, arguments ...])
Since anything can be run at the shell, system() is deemed an unsafe function and requires the --unsafe bpftrace option to be used.

For example, calling ps(1) to print details on the PID calling nanosleep():

Click here to view code image


# bpftrace --unsafe -e 't:syscalls:sys_enter_nanosleep { system("ps -p %d\n",
    pid); }'
Attaching 1 probe...
  PID TTY          TIME CMD
29893 tty2     05:34:22 mysqld
  PID TTY          TIME CMD
29893 tty2     05:34:22 mysqld
  PID TTY          TIME CMD
29893 tty2     05:34:22 mysqld
[...]

If the traced event was frequent, using system() could create a storm of new process events that consume CPU resources. Only use system() when necessary.

5.13.8 exit()
This terminates the bpftrace program. Syntax:

Click here to view code image


exit()
This function can be used in an interval probe to instrument for a fixed duration. For example:

Click here to view code image


# bpftrace -e 't:syscalls:sys_enter_read { @reads = count(); }
    interval:s:5 { exit(); }'
Attaching 2 probes...
@reads: 735

This shows that in five seconds, there were 735 read() syscalls. All maps are printed out upon bpftrace termination, as seen in this example.

5.14 BPFTRACE MAP FUNCTIONS
Maps are special hash table storage objects from BPF that can be used for different purposes—for example, as hash tables to store key/value pairs or for statistical summaries. bpftrace provides built-in functions for map assignment and manipulation, mostly for supporting statistical summary maps. The most important map functions are listed in Table 5-7.

Table 5-7 bpftrace Selected Map Functions

Function

Description

count()

Counts occurrences

sum(int n)

Sums the value

avg(int n)

Averages the value

min(int n)

Records the minimum value

max(int n)

Records the maximum value

stats(int n)

Returns the count, average, and total

hist(int n)

Prints a power-of-two histogram of values

lhist(int n, int min, int max, int step)

Prints a linear histogram of values

delete(@m[key])

Deletes the map key/value pair

print(@m [, top [, div]])

Prints the map, with optional limits and a divisor

clear(@m)

Deletes all keys from the map

zero(@m)

Sets all map values to zero

Some of these functions are asynchronous: The kernel queues the event, and a short time later, it is processed in user space. The asynchronous actions are print(), clear(), and zero(). Bear in mind this delay when you are writing programs.

See the online “bpftrace Reference Guide” for the full and updated list of functions [66]. A selection of these functions are discussed in the following sections.

5.14.1 count()
count() counts occurrences. Syntax:

Click here to view code image


@m = count();
This function can be used with probe wildcards and the probe built-in to count events:

Click here to view code image


# bpftrace -e 'tracepoint:block:* { @[probe] = count(); }'
Attaching 18 probes...
^C

@[tracepoint:block:block_rq_issue]: 1
@[tracepoint:block:block_rq_insert]: 1
@[tracepoint:block:block_dirty_buffer]: 24
@[tracepoint:block:block_touch_buffer]: 29
@[tracepoint:block:block_rq_complete]: 52
@[tracepoint:block:block_getrq]: 91
@[tracepoint:block:block_bio_complete]: 102
@[tracepoint:block:block_bio_remap]: 180
@[tracepoint:block:block_bio_queue]: 270

With the interval probe, a per-interval rate can be printed, for example:

Click here to view code image


# bpftrace -e 'tracepoint:block:block_rq_i* { @[probe] = count(); }
    interval:s:1 { print(@); clear(@); }'
Attaching 3 probes...
@[tracepoint:block:block_rq_issue]: 1
@[tracepoint:block:block_rq_insert]: 1

@[tracepoint:block:block_rq_insert]: 6
@[tracepoint:block:block_rq_issue]: 8

@[tracepoint:block:block_rq_issue]: 1
@[tracepoint:block:block_rq_insert]: 1
[...]

This basic functionality can also be accomplished by using perf(1) and perf stat, as well as Ftrace. bpftrace enables more customizations: A BEGIN probe could contain a printf() call to explain the output, and the interval probe could include a time() call to annotate each interval with timestamps.

5.14.2 sum(), avg(), min(), and max()
These functions store basic statistics—the sum, average, minimum, and maximum—as a map. Syntax:

Click here to view code image


sum(int n)
avg(int n)
min(int n)
max(int n)

For example, using sum() to find the total bytes read via the read(2) syscall:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_read /args->ret > 0/ {
   @bytes = sum(args->ret); }'
Attaching 1 probe...
^C

@bytes: 461603

The map was named “bytes” to annotate the output. Note that this example uses a filter to ensure that args->ret is positive: A positive return value from read(2) indicates the number of bytes read, whereas a negative return value is an error code. This is documented in the man page for read(2).

5.14.3 hist()
hist() stores a value in a power-of-two histogram. Syntax:

Click here to view code image


hist(int n)
For example, a histogram of successful read(2) sizes:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_read { @ret = hist(args->ret); }'
Attaching 1 probe...
^C

@ret:
(..., 0)             237 |@@@@@@@@@@@@@@                                      |
[0]                   13 |                                                    |
[1]                  859 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[2, 4)                57 |@@@                                                 |
[4, 8)                 5 |                                                    |
[8, 16)              749 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@       |
[16, 32)              69 |@@@@                                                |
[32, 64)              64 |@@@                                                 |
[64, 128)             25 |@                                                   |
[128, 256)             7 |                                                    |
[256, 512)             5 |                                                    |
[512, 1K)              7 |                                                    |
[1K, 2K)              32 |@                                                   |

Histograms are useful for identifying distribution characteristics such as multi-modal distributions and outliers. This example histogram has multiple modes, one for reads that were 0 or less in size (less than zero will be error codes), another mode for one byte in size, and another for sizes between eight to 16 bytes.

The characters in the ranges are from interval notation:

"[": Equal to or greater than

"]": Equal to or less than

"(": Greater than

")": Less than

"…": Infinite

The range “[4, 8)” means between four and less-than-eight (that is, between four and 7.9999, etc.).

5.14.4 lhist()
lhist() stores a value as a linear histogram. Syntax:

Click here to view code image


lhist(int n, int min, int max, int step)
For example, a linear histogram of read(2) returns:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_read {
    @ret = lhist(args->ret, 0, 1000, 100); }'
Attaching 1 probe...
^C

@ret:
(..., 0)             101 |@@@                                                 |
[0, 100)            1569 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[100, 200)             5 |                                                    |
[200, 300)             0 |                                                    |
[300, 400)             3 |                                                    |
[400, 500)             0 |                                                    |
[500, 600)             0 |                                                    |
[600, 700)             3 |                                                    |
[700, 800)             0 |                                                    |
[800, 900)             0 |                                                    |
[900, 1000)            0 |                                                    |
[1000, ...)            5 |                                                    |

The output shows that most reads were between zero and (less than) 100 bytes. The ranges are printed using the same interval notation as with hist(). The “(..., 0)” line shows the error count: 101 read(2) errors while tracing. Note that error counts are better viewed differently, such as by using a frequency count of the error codes:

Click here to view code image


# bpftrace -e 'tracepoint:syscalls:sys_exit_read /args->ret < 0/ {
    @[- args->ret] = count(); }'
Attaching 1 probe...
^C

@[11]: 57

Error code 11 is EAGAIN (try again). read(2) returns it as -11.

5.14.5 delete()
delete() deletes a key/value pair from a map. Syntax:

Click here to view code image


delete(@map[key])
There may be more than one key, as needed, to match the map type.

5.14.6 clear() and zero()
clear() deletes all key/value pairs from a map, and zero() sets all values to zero. Syntax:

Click here to view code image


clear(@map)
zero(@map)

When bpftrace terminates, all maps are printed out by default. Some maps, such as those used for timestamp delta calculations, aren’t intended to be part of the tool output. They can be cleaned up in an END probe to prevent their automatic printing:

Click here to view code image


[...]
END
{
    clear(@start);
}

5.14.7 print()
print() prints maps. Syntax:

Click here to view code image


print(@m [, top [, div]])
Two optional arguments can be provided: a top integer, so that only the top number of entries is printed, and a divisor integer, which divides the value.

To demonstrate the top argument, the following prints the top five kernel function calls that begin with “vfs_”:

Click here to view code image


# bpftrace -e 'kprobe:vfs_* { @[probe] = count(); } END { print(@, 5); clear(@); }'
Attaching 55 probes...
^C
@[kprobe:vfs_getattr_nosec]: 510
@[kprobe:vfs_getattr]: 511
@[kprobe:vfs_writev]: 1595
@[kprobe:vfs_write]: 2086
@[kprobe:vfs_read]: 2921

While tracing, vfs_read() was called the most (2921 times).

To demonstrate the div argument, the following records time spent in vfs_read() by process name and prints it out in milliseconds:

Click here to view code image


# bpftrace -e 'kprobe:vfs_read { @start[tid] = nsecs; }
    kretprobe:vfs_read /@start[tid]/ {
      @ms[comm] = sum(nsecs - @start[tid]); delete(@start[tid]); }
    END { print(@ms, 0, 1000000); clear(@ms); clear(@start); }'
Attaching 3 probes...
[...]
@ms[Xorg]: 3
@ms[InputThread]: 3
@ms[chrome]: 4
@ms[Web Content]: 5

Why was it necessary to have the divisor? You could try writing this program like this instead:

Click here to view code image


@ms[comm] = sum((nsecs - @start[tid]) / 1000000);
However, sum() operates on integers, and decimal places are rounded down (floored). So any duration less than one millisecond is summed as zero. This results in an output ruined by rounding errors. The solution is to sum() nanoseconds, which preserves the sub-millisecond durations, and then do the divisor on the totals as the argument to print().

A future bpftrace change may allow print() to print any type, not just maps, without formatting.

5.15 BPFTRACE FUTURE WORK
There are a number of planned additions to bpftrace that may be available by the time you read this book. See the bpftrace release notes and documentation in the repository for these additions: https://github.com/iovisor/bpftrace.

There are no planned changes to the bpftrace source code included in this book. In case changes do become necessary, check for updates on this book’s website: http://www.brendangregg.com/bpf-performance-tools-book.html.

5.15.1 Explicit Address Modes
The largest addition to bpftrace will be explicit address space access to support a future split of bpf_probe_read() into bpf_probe_read_kernel() and bpf_probe_read_user() [69]. This split is necessary to support some processor architectures.13 It should not affect any of the tools in this book. It should result in the addition of kptr() and uptr() bpftrace functions to specify the address mode. Needing to use these should be rare: bpftrace will figure out the address space context whenever possible from the probe type or function used. The following shows how the probe context should work:

13 “They are rare, but they exist. At least sparc32 and the old 4G:4G split x86.”—Linus Torvalds [70]

kprobe/kretprobe (kernel context):

arg0...argN, retval: When dereferenced, are kernel addresses.

*addr: Dereferences a kernel address.

str(addr): Fetches a NULL-terminated kernel string.

*uptr(addr): Dereferences a user address.

str(uptr(addr)): Fetches a null-terminated user string.

uprobe/uretprobe (user context):

arg0...argN, retval: When dereferenced, are user addresses.

*addr: Dereferences a user address.

str(addr): Fetches a NULL-terminated user string.

*kptr(addr): Dereferences a kernel address.

str(kptr(addr)): Fetches a NULL-terminated kernel string.

So *addr and str() will continue to work, but will refer to the probe-context address space: kernel memory for kprobes and user memory for uprobes. To cross address spaces, the kptr() and uptr() functions must be used. Some functions, such as curtask(), will always return a kernel pointer, regardless of the context (as would be expected).

Other probe types default to kernel context, but there will be some exceptions, documented in the “bpftrace Reference Guide” [66]. One exception will be syscall tracepoints, which refer to user address space pointers, and so their probe action will be in user space context.

5.15.2 Other Additions
Other planned additions include:

Additional probe types for memory watchpoints,14 socket and skb programs, and raw tracepoints

14 Dan Xu has already developed a proof of concept implementation for memory watchpoints that is included in bpftrace [71].

uprobe and kprobe function offset probes

for and while loops that make use of BPF bounded loops in Linux 5.3

Raw PMC probes (providing a umask and event select)

uprobes to also support relative names without full paths (e.g., both uprobe:/lib/x86_64-linux-gnu/libc.so.6:... and uprobe:libc:... should work)

signal() to raise a signal (including SIGKILL) to processes

return() or override() to rewrite the return of events (using bpf_override_return())

ehist() for exponential histograms. Any tool or one-liner that currently uses the power-of-two hist() could be switched to ehist() for more resolution.

pcomm to return the process name. comm returns the thread name, which is usually the same, but some applications, such as Java, may set comm to per-thread names; in that case, pcomm would still return "java".

A helper function for struct file pointers to full pathnames

Once these additions are available, you may want to switch a few tools in this book from hist() to ehist() for more resolution, and some uprobe tools to use relative library names instead of the full paths for ease of use.

5.15.3 ply
The ply BPF front end, created by Tobias Waldekranz, provides a high-level language similar to bpftrace and requires minimal dependencies (no LLVM or Clang). This makes it suited to resource-constrained environments, with the drawback that struct navigation and including header files (as required by many tools in this book) are not possible.

An example of ply instrumenting the open(2) tracepoint:

Click here to view code image


# ply 'tracepoint:syscalls/sys_enter_open {
    printf("PID: %d (%s) opening: %s\n", pid, comm, str(data->filename)); }'
ply: active
PID: 22737 (Chrome_IOThread) opening: /dev/shm/.org.chromium.Chromium.dh4msB
PID: 22737 (Chrome_IOThread) opening: /dev/shm/.org.chromium.Chromium.dh4msB
PID: 22737 (Chrome_IOThread) opening: /dev/shm/.org.chromium.Chromium.2mIlx4
[...]

The above one-liner is almost identical to the equivalent in bpftrace. A future version of ply could support the bpftrace language directly, providing a lightweight tool for running bpftrace one-liners. These one-liners typically do not use struct navigation other than the tracepoint arguments (as shown by this example), which ply already supports. In the distant future, with BTF availability, ply could use BTF for struct information, allowing it to run more of the bpftrace tools.

5.16 BPFTRACE INTERNALS
Figure 5-3 shows the internal operation of bpftrace.


Figure 5-3 bpftrace internals

bpftrace uses libbcc and libbpf to attach to probes, load programs, and use USDT. It also uses LLVM for compiling the program to BPF bytecode.

The bpftrace language is defined by lex and yacc files that are processed by flex and bison. The output is the program as an abstract syntax tree (AST). Tracepoint and Clang parsers then process structs. A semantic analyzer checks the use of language elements, and throws errors for misuse. The next step is code generation—converting the AST nodes to LLVM IR, which LLVM finally compiles to BPF bytecode.

The next section introduces bpftrace debugging modes that show these steps in action: -d prints the AST and the LLVM IR, and -v prints the BPF bytecode.

5.17 BPFTRACE DEBUGGING
There are various ways to debug and troubleshoot bpftrace programs. This section summarizes printf() statements and bpftrace debug modes. If you are here because you are troubleshooting an issue, also see Chapter 18, which covers common issues, including missing events, missing stacks, and missing symbols.

While bpftrace is a powerful language, it is really composed from a set of rigid capabilities that are designed to work safely together and to reject misuse. In comparison, BCC, which allows C and Python programs, uses a much larger set of capabilities that were not designed solely for tracing and that may not necessarily work together. The result is that bpftrace programs tend to fail with human-readable messages that do not require further debugging, whereas BCC programs can fail in unexpected ways, and require debugging modes to solve.

5.17.1 printf() Debugging
printf() statements can be added to show whether probes are really firing and whether variables are what you think they are. Consider the following program: it prints a histogram of vfs_read() duration. However, if you run it, you may discover that the output includes outliers with unbelievably high durations. Can you spot the bug?

Click here to view code image


kprobe:vfs_read
{
        @start[tid] = nsecs;
}

kretprobe:vfs_read
{
        $duration_ms = (nsecs - @start[tid]) / 1000000;
        @ms = hist($duration_ms);
        delete(@start[tid]);
}

If bpftrace begins running halfway through a vfs_read() call, then only the kretprobe will fire, and the latency calculation becomes “nsecs - 0”, as @start[tid] is uninitialized. The fix is to use a filter on the kretprobe to check that @start[tid] is non-zero before you use it in the calculation. This could be debugged with a printf() statement to examine the inputs:

Click here to view code image


printf("$duration_ms = (%d - %d) / 1000000\n", nsecs, @start[tid]);
There are bpftrace debug modes (covered next), but bugs like this may be quickly solved with a well-placed printf().

5.17.2 Debug Mode
The -d option to bpftrace runs debug mode, which does not run the program but instead shows how it was parsed and converted to LLVM IR. Note that this mode may only really be of interest to developers of bpftrace itself, and it is included here for awareness.

It begins by printing an abstract syntax tree (AST) representation of the program:

Click here to view code image


# bpftrace -d -e 'k:vfs_read { @[pid] = count(); }'
Program
 k:vfs_read
  =
   map: @
    builtin: pid
   call: count

followed by the program converted to LLVM IR assembly:

Click here to view code image


; ModuleID = 'bpftrace'
source_filename = "bpftrace"
target datalayout = "e-m:e-p:64:64-i64:64-n32:64-S128"
target triple = "bpf-pc-linux"

; Function Attrs: nounwind
declare i64 @llvm.bpf.pseudo(i64, i64) #0

; Function Attrs: argmemonly nounwind
declare void @llvm.lifetime.start.p0i8(i64, i8* nocapture) #1

define i64 @"kprobe:vfs_read"(i8* nocapture readnone) local_unnamed_addr section
"s_kprobe:vfs_read_1" {
entry:
  %"@_val" = alloca i64, align 8
  %"@_key" = alloca [8 x i8], align 8
  %1 = getelementptr inbounds [8 x i8], [8 x i8]* %"@_key", i64 0, i64 0
  call void @llvm.lifetime.start.p0i8(i64 -1, i8* nonnull %1)
  %get_pid_tgid = tail call i64 inttoptr (i64 14 to i64 ()*)()
  %2 = lshr i64 %get_pid_tgid, 32
  store i64 %2, i8* %1, align 8
  %pseudo = tail call i64 @llvm.bpf.pseudo(i64 1, i64 1)
  %lookup_elem = call i8* inttoptr (i64 1 to i8* (i8*, i8*)*)(i64 %pseudo, [8 x i8]*
nonnull %"@_key")
  %map_lookup_cond = icmp eq i8* %lookup_elem, null
  br i1 %map_lookup_cond, label %lookup_merge, label %lookup_success

lookup_success:                                   ; preds = %entry
  %3 = load i64, i8* %lookup_elem, align 8
  %phitmp = add i64 %3, 1
  br label %lookup_merge

lookup_merge:                                     ; preds = %entry, %lookup_success
  %lookup_elem_val.0 = phi i64 [ %phitmp, %lookup_success ], [ 1, %entry ]
  %4 = bitcast i64* %"@_val" to i8*
  call void @llvm.lifetime.start.p0i8(i64 -1, i8* nonnull %4)
  store i64 %lookup_elem_val.0, i64* %"@_val", align 8
  %pseudo1 = call i64 @llvm.bpf.pseudo(i64 1, i64 1)
  %update_elem = call i64 inttoptr (i64 2 to i64 (i8*, i8*, i8*, i64)*)(i64 %pseudo1,
[8 x i8]* nonnull %"@_key", i64* nonnull %"@_val", i64 0)
  call void @llvm.lifetime.end.p0i8(i64 -1, i8* nonnull %1)
  call void @llvm.lifetime.end.p0i8(i64 -1, i8* nonnull %4)
  ret i64 0
}

; Function Attrs: argmemonly nounwind
declare void @llvm.lifetime.end.p0i8(i64, i8* nocapture) #1

attributes #0 = { nounwind }
attributes #1 = { argmemonly nounwind }

There is also a -dd mode, verbose debug, that prints extra information: the LLVM IR assembly before and after optimization.

5.17.3 Verbose Mode
The -v option to bpftrace is verbose mode, printing extra information while running the program. For example:

Click here to view code image


# bpftrace -v -e 'k:vfs_read { @[pid] = count(); }'
Attaching 1 probe...

Program ID: 5994

Bytecode:
0: (85) call bpf_get_current_pid_tgid#14
1: (77) r0 >>= 32
2: (7b) *(u64 *)(r10 -16) = r0
3: (18) r1 = 0xffff892f8c92be00
5: (bf) r2 = r10
6: (07) r2 += -16
7: (85) call bpf_map_lookup_elem#1
8: (b7) r1 = 1
9: (15) if r0 == 0x0 goto pc+2
 R0=map_value(id=0,off=0,ks=8,vs=8,imm=0) R1=inv1 R10=fp0
10: (79) r1 = *(u64 *)(r0 +0)
 R0=map_value(id=0,off=0,ks=8,vs=8,imm=0) R1=inv1 R10=fp0
11: (07) r1 += 1
12: (7b) *(u64 *)(r10 -8) = r1
13: (18) r1 = 0xffff892f8c92be00
15: (bf) r2 = r10
16: (07) r2 += -16
17: (bf) r3 = r10
18: (07) r3 += -8
19: (b7) r4 = 0
20: (85) call bpf_map_update_elem#2
21: (b7) r0 = 0
22: (95) exit

from 9 to 12: safe
processed 22 insns, stack depth 16

Attaching kprobe:vfs_read
Running...
^C

@[6169]: 1
@[28178]: 1
[...]

The program ID can be used with bpftool to print information on BPF kernel state, as shown in Chapter 2. The BPF bytecode is then printed, followed by the probe it is attaching to.

As with -d, this level of detail may only be of use to developers of bpftrace internals. Users should not need to be reading BPF bytecode while using bpftrace.

5.18 SUMMARY
bpftrace is a powerful tracer with a concise high-level language. This chapter describes its features, tools, and example one-liners. It also covers programming and provides sections on probes, flow control, variables, and functions. The chapter finishes with debugging and internals.

The following chapters cover targets of analysis and include both BCC and bpftrace tools. An advantage of bpftrace tools is that their source code is often so concise that it can be included in this book.

CopyAdd HighlightAdd Note
back to top
