# Chapter 2. Technology Background
Chapter 1 introduced various technologies used by BPF performance tools. This chapter explains them in more detail: their histories, interfaces, internals, and use with BPF.

This is the most technically deep chapter in the book, and for the sake of brevity, it assumes some knowledge of kernel internals and instruction-level programming.1

1 To learn necessary kernel internals, refer to any guide that covers syscalls, kernel and user mode, tasks/threads, virtual memory, and VFS, such as [Gregg 13b].

The learning objectives are not to memorize every page in this chapter, but for you to:

Know the origins of BPF, and the role of extended BPF today

Understand frame pointer stack walking and other techniques

Understand how to read flame graphs

Understand the use of kprobes and uprobes, and be familiar with their stability caveats

Understand the role of tracepoints, USDT probes, and dynamic USDT

Be aware of PMCs and their use with BPF tracing tools

Be aware of future developments: BTF, other BPF stack walkers

Understanding this chapter will improve your comprehension of later content in this book, but you may prefer to skim through this chapter now and return to it for more detail as needed. Chapter 3 will get you started on using BPF tools to find performance wins.

2.1 BPF ILLUSTRATED
Figure 2-1 shows many of the technologies in this chapter and their relationships to each other.


Figure 2-1 BPF tracing technologies

2.2 BPF
BPF was originally developed for the BSD operating system, and is described in the 1992 paper “The BSD Packet Filter: A New Architecture for User-level Packet Capture” [McCanne 92]. This paper was presented at the 1993 USENIX Winter conference in San Diego, alongside “Measurement, Analysis, and Improvement of UDP/IP Throughput for the DECstation 5000” [7]. DECstations are long gone, but BPF has survived as the industry standard solution for packet filtering.

BPF works in an interesting way: A filter expression is defined by the end user using an instruction set for a BPF virtual machine (sometimes called the BPF bytecode) and then passed to the kernel for execution by an interpreter. This allows filtering to occur in the kernel level without costly copies of each packet going to the user-level processes, improving the performance of packet filtering, as used by tcpdump(8). It also provides safety, as filters from user space can be verified as being safe before execution. Given that early packet filtering had to occur in kernel space, safety was a hard requirement. Figure 2-2 shows how this works.


Figure 2-2 tcpdump and BPF

You can use the -d option to tcpdump(8) to print out the BPF instructions it is using for the filter expression. For example:

Click here to view code image


# tcpdump -d host 127.0.0.1 and port 80
(000) ldh      [12]
(001) jeq      #0x800           jt 2      jf 18
(002) ld       [26]
(003) jeq      #0x7f000001      jt 6      jf 4
(004) ld       [30]
(005) jeq      #0x7f000001      jt 6      jf 18
(006) ldb      [23]
(007) jeq      #0x84            jt 10     jf 8
(008) jeq      #0x6             jt 10     jf 9
(009) jeq      #0x11            jt 10     jf 18
(010) ldh      [20]
(011) jset     #0x1fff          jt 18     jf 12
(012) ldxb     4*([14]&0xf)
(013) ldh      [x + 14]
(014) jeq      #0x50            jt 17     jf 15
(015) ldh      [x + 16]
(016) jeq      #0x50            jt 17     jf 18
(017) ret      #262144
(018) ret      #0

The original BPF, now referred to as “classic BPF,” was a limited virtual machine. It had two registers, a scratch memory store consisting of 16 memory slots, and a program counter. These were all operating with a 32-bit register size.2 Classic BPF arrived in Linux in 1997, for the 2.1.75 kernel [8].

2 For classic BPF on a 64-bit kernel, addresses are 64-bit, but the registers only ever see 32-bit data, and the loads are hidden behind some external kernel helper functions.

Since the addition of BPF to the Linux kernel, there have been some important improvements. Eric Dumazet added a BPF just-in-time (JIT) compiler in Linux 3.0, released in July 2011 [9], improving performance over the interpreter. In 2012, Will Drewry added BPF filters for seccomp (secure computing) syscall policies [10]; this was the first use of BPF outside of networking, and it showed the potential for BPF to be used as a generic execution engine.

2.3 EXTENDED BPF (EBPF)
Extended BPF was created by Alexei Starovoitov while he worked at PLUMgrid, as the company was investigating new ways to create software-defined networking solutions. This would be the first major update to BPF in 20 years, and one that would extend BPF to become a general-purpose virtual machine.3 While it was still a proposal, Daniel Borkmann, a kernel engineer at Red Hat, helped rework it for inclusion in the kernel and as a replacement for the existing BPF.4 This extended BPF was successfully included and has since had contributions from many other developers (see the Acknowledgments).

3 While BPF is often called a virtual machine, that only describes its specification. Its implementation in Linux (its runtime) has an interpreter and a JIT-to-native code compiler. The term virtual machine may imply that there is another machine layer on top of the processor, but there isn’t. With JIT compiled code, instructions run directly on the processor just like any other native kernel code. Note that after the Spectre vulnerability, some distributions unconditionally enable the JIT for x86, which removes the interpreter entirely (as it gets compiled out).

4 Alexei and Daniel have since changed companies. They are also currently the kernel “maintainers” for BPF: a role where they provide leadership, review patches, and decide what gets included.

Extended BPF added more registers, switched from 32-bit to 64-bit words, created flexible BPF “map” storage, and allowed calls to some restricted kernel functions.5 It was also designed to be JITed with a one-to-one mapping to native instructions and registers, allowing prior native instruction optimization techniques to be reused for BPF. The BPF verifier was also updated to handle these extensions and reject any unsafe code.

5 Without needing to overload instructions, a workaround used with classic BPF that was complicated as every JIT needed to be changed to handle it.

Table 2-1 shows the differences between classic BPF and extended BPF.

Table 2-1 Classic BPF Versus Extended BPF

Factor

Classic BPF

Extended BPF

Register count

2: A, X

10: R0–R9, plus R10 as a read-only frame pointer

Register width

32-bit

64-bit

Storage

16 memory slots: M[0–15]

512 bytes of stack space, plus infinite “map” storage

Restricted kernel calls

Very limited, JIT specific

Yes, via the bpf_call instruction

Event targets

Packets, seccomp-BPF

Packets, kernel functions, user functions, tracepoints, user markers, PMCs

Alexei’s original proposal was a patchset in September 2013 titled “extended BPF” [2]. By December 2013, Alexei was already proposing its use for tracing filters [11]. After discussion and development with Daniel, the patches began to merge in the Linux kernel by March 2014 [3][12].6 The JIT components were merged for the Linux 3.15 release in June 2014, and the bpf(2) syscall for controlling BPF was merged for the Linux 3.18 release in December 2014 [13]. Later additions in the Linux 4.x series added BPF support for kprobes, uprobes, tracepoints, and perf_events.

6 Early on, it was also called “internal BPF,” before it was exposed via the bpf(2) syscall. Since BPF was a networking technology, these patches were sent to and accepted by the networking maintainer David S. Miller. Today, BPF has grown into a larger kernel community of its own, and all BPF-related patches are merged into their own bpf and bpf-next kernel trees. Tradition is steady that BPF tree pull requests are still accepted by David S. Miller.

In the earliest patchsets, the technology was abbreviated as eBPF, but Alexei later switched to calling it just BPF.7 All BPF development on the net-dev mailing list [14] now refers to it as just BPF.

7 I also suggested to Alexei that we come up with a different and better name. But naming is hard, and we’re engineers, so we’re stuck with “it’s eBPF but really just BPF, which stands for Berkeley Packet Filter although today it has little to do with Berkeley, packets, or filtering.” Thus, BPF should be regarded now as a technology name rather than as an acronym.

The architecture of the Linux BPF runtime is illustrated in Figure 2-3, which shows how BPF instructions pass the BPF verifier to be executed by a BPF virtual machine. The BPF virtual machine implementation has both an interpreter and a JIT compiler: the JIT compiler generates native instructions for direct execution. The verifier rejects unsafe operations, including unbounded loops: BPF programs must finish in a bounded time.


Figure 2-3 BPF runtime internals

BPF can make use of helpers for fetching kernel state, and BPF maps for storage. The BPF program is executed on events, which include kprobes, uprobes, and tracepoints.

The next sections discuss why performance tools need BPF, extended BPF programming, viewing BPF instructions, the BPF API, BPF limitations, and BTF. These sections provide a basis for understanding how BPF works when using bpftrace and BCC. In addition, Appendix D covers BPF programming in C directly, and Appendix E covers BPF instructions.

2.3.1 Why Performance Tools Need BPF
Performance tools use extended BPF in part for its programmability. BPF programs can execute custom latency calculations and statistical summaries. Those features alone would make for an interesting tool, and there are plenty of other tracing tools that have those features. What makes BPF different is that it is also efficient and production safe, and it is built into the Linux kernel. With BPF, you can run these tools in production environments without needing to add any new kernel components.

Let’s look at some output and a diagram to see how performance tools use BPF. This example comes from an early BPF tool I published called bitehist, which shows the size of disk I/O as a histogram [15]:

Click here to view code image


# bitehist
Tracing block device I/O... Interval 5 secs. Ctrl-C to end.

     kbytes          : count     distribution
       0 -> 1        : 3        |                                      |
       2 -> 3        : 0        |                                      |
       4 -> 7        : 3395     |************************************* |
       8 -> 15       : 1        |                                      |
      16 -> 31       : 2        |                                      |
      32 -> 63       : 738      |*******                               |
      64 -> 127      : 3        |                                      |
     128 -> 255      : 1        |                                      |

Figure 2-4 shows how BPF improves the efficiency of this tool.


Figure 2-4 Generating histograms before and after using BPF

The key change is that the histogram can be generated in kernel context, which greatly reduces the amount of data copied to user space. This efficiency gain is so great that it can allow tools to run in production that would otherwise be too costly. In detail:

Prior to BPF, the full steps to produce this histogram summary were8:

In the kernel: enable instrumentation for disk I/O events.

In the kernel, for each event: write a record to the perf buffer. If tracepoints are used (as is preferred), the record contains several fields of metadata about the disk I/O.

In user space: periodically copy the buffer of all events to user space.

In user space: step over each event, parsing the event metadata for the bytes field. Other fields are ignored.

In user space: generate a histogram summary of the bytes field.

8 These are the best steps available, but they don’t show the only method. You could install an out-of-tree tracer, like SystemTap, but, depending on your kernel and distribution, that could be a rocky experience. You could also modify the kernel code, or develop a custom kprobe module, but both of these methods involve challenges and carry their own risks. I developed my own workaround that I called the “hacktogram,” which involved creating multiple perf(1) stat counters with range filters for each row in the histogram [16]. It was horrible.

Steps 2 to 4 have high performance overhead for high-I/O systems. Imagine transferring 10,000 disk I/O trace records to a user-space program to parse and summarize—every second.

With BPF, the steps for the bitesize program are:

In the kernel: enable instrumentation for disk I/O events and attach a custom BPF program, defined by bitesize.

In the kernel, for each event: run the BPF program. It fetches the bytes field alone and saves it into a custom BPF map histogram.

In user space: read the BPF map histogram once and print it out.

This method avoids the cost of copying events to user space and reprocessing them. It also avoids copying metadata fields that are not used. The only data copied to user space is shown in the previous output: the “count” column, which is an array of numbers.

2.3.2 BPF Versus Kernel Modules
Another way to understand the benefits of BPF for observability is to compare it to kernel modules. kprobes and tracepoints have been available for many years, and they can be used from loadable kernel modules directly. The benefits of using BPF over kernel modules for tracing purposes are:

BPF programs are checked via a verifier; kernel modules may introduce bugs (kernel panics) or security vulnerabilities.

BPF provides rich data structures via maps.

BPF programs can be compiled once and then run anywhere, as the BPF instruction set, map, helpers, and infrastructure are a stable ABI. (However, this is not possible with some BPF tracing programs that introduce unstable components, such as kprobes that instrument kernel structures; see Section 2.3.10 for work on a solution.)

BPF programs do not require kernel build artifacts to be compiled.

BPF programming is easier to learn than the kernel engineering required to develop kernel modules, making it accessible to more people.

Note that there are additional benefits when BPF is used for networking, including the ability to replace BPF programs atomically. A kernel module would need to first unload out of the kernel entirely and then reload the new version into the kernel, which could cause service disruptions.

A benefit of kernel modules is that other kernel functions and facilities can be used, without the restriction to BPF helper calls only. However, this brings the additional risk of introducing bugs if arbitrary kernel functions are misused.

2.3.3 Writing BPF Programs
BPF can be programmed via one of the many front ends available. The main ones for tracing are, from lowest- to highest-level language:

LLVM

BCC

bpftrace

The LLVM compiler supports BPF as a compilation target. BPF programs can be written using a higher-level language that LLVM supports, such as C (via Clang) or LLVM Intermediate Representation (IR), and then compiled into BPF. LLVM includes an optimizer, which improves the efficiency and size of the BPF instructions it emits.

While developing BPF in LLVM IR is an improvement, switching to BCC or bpftrace is even better. BCC allows BPF programs to be written in C, and bpftrace provides its own higher-level language. Internally, they are using LLVM IR and an LLVM library to compile to BPF.

The performance tools in this book are programmed in BCC and bpftrace. Programming in BPF instructions directly, or LLVM IR, is the domain of developers who work on BCC and bpftrace internals and is beyond the scope of this book. It is unnecessary for those of us using and developing BPF performance tools.9 If you wish to become a BPF instruction developer or are curious, here are some resources for additional reading:

9 Having spent 15 years using DTrace, I cannot remember a time when anyone needed to write D Intermediate Format (DIF) programs directly (the DTrace equivalent of BPF instructions).

Appendix E provides a brief summary of BPF instructions and macros.

BPF instructions are documented in the Linux source tree, Documentation/networking/filter.txt [17].

LLVM IR is documented in the online LLVM reference; start with the llvm::IRBuilderBase Class Reference [18].

See the Cilium BPF and XDP Reference Guide [19].

While most of us will never program BPF instructions directly, many of us will view them at times, such as when tools encounter issues. The next two sections show examples, using bpftool(8) and then bpftrace.

2.3.4 Viewing BPF Instructions: bpftool
bpftool(8) was added in Linux 4.15 for viewing and manipulating BPF objects, including programs and maps. It is in the Linux source under tools/bpf/bpftool. This section summarizes how to use bpftool(8) to find loaded BPF programs and print their instructions.

bpftool
The default output of bpftool(8) shows the object types that it operates on. From Linux 5.2:

Click here to view code image


# bpftool
Usage: bpftool [OPTIONS] OBJECT { COMMAND | help }
       bpftool batch file FILE
       bpftool version

       OBJECT := { prog | map | cgroup | perf | net | feature | btf }
       OPTIONS := { {-j|--json} [{-p|--pretty}] | {-f|--bpffs} |
                    {-m|--mapcompat} | {-n|--nomount} }

There is a separate help page for each object. For example, for programs:

Click here to view code image


# bpftool prog help
Usage: bpftool prog { show | list } [PROG]
       bpftool prog dump xlated PROG [{ file FILE | opcodes | visual | linum }]
       bpftool prog dump jited  PROG [{ file FILE | opcodes | linum }]
       bpftool prog pin   PROG FILE
       bpftool prog { load | loadall } OBJ  PATH \
                         [type TYPE] [dev NAME] \
                         [map { idx IDX | name NAME } MAP]\
                         [pinmaps MAP_DIR]
       bpftool prog attach PROG ATTACH_TYPE [MAP]
       bpftool prog detach PROG ATTACH_TYPE [MAP]
       bpftool prog tracelog
       bpftool prog help
       MAP := { id MAP_ID | pinned FILE }
       PROG := { id PROG_ID | pinned FILE | tag PROG_TAG }
       TYPE := { socket | kprobe | kretprobe | classifier | action |q
[...]

The perf and prog subcommands can be used to find and print tracing programs. bpftool(8) capabilities not covered here include attaching programs, reading and writing to maps, operating on cgroups, and listing BPF features.

bpftool perf
The perf subcommand shows BPF programs attached via perf_event_open(), which is the norm for BCC and bpftrace programs on Linux 4.17 and later. For example:

Click here to view code image


# bpftool perf
pid 1765  fd 6: prog_id 26  kprobe  func blk_account_io_start  offset 0
pid 1765  fd 8: prog_id 27  kprobe  func blk_account_io_done  offset 0
pid 1765  fd 11: prog_id 28  kprobe  func sched_fork  offset 0
pid 1765  fd 15: prog_id 29  kprobe  func ttwu_do_wakeup  offset 0
pid 1765  fd 17: prog_id 30  kprobe  func wake_up_new_task  offset 0
pid 1765  fd 19: prog_id 31  kprobe  func finish_task_switch  offset 0
pid 1765  fd 26: prog_id 33  tracepoint  inet_sock_set_state
pid 21993  fd 6: prog_id 232  uprobe  filename /proc/self/exe  offset 1781927
pid 21993  fd 8: prog_id 233  uprobe  filename /proc/self/exe  offset 1781920
pid 21993  fd 15: prog_id 234  kprobe  func blk_account_io_done  offset 0
pid 21993  fd 17: prog_id 235  kprobe  func blk_account_io_start  offset 0
pid 25440  fd 8: prog_id 262  kprobe  func blk_mq_start_request  offset 0
pid 25440  fd 10: prog_id 263  kprobe  func blk_account_io_done  offset 0

This output shows three different PIDs with various BPF programs:

PID 1765 is a Vector BPF PMDA agent for instance analysis. (See Chapter 17 for more details.)

PID 21993 is the bpftrace version of biolatency(8). It shows two uprobes, which are the BEGIN and END probes from the bpftrace program, and two kprobes for instrumenting the start and end of block I/O. (See Chapter 9 for the source to this program.)

PID 25440 is the BCC version of biolatency(8), which currently instruments a different start function for the block I/O.

The offset field shows the offset of the instrumentation from the instrumented object. For bpftrace, offset 1781920 matches the BEGIN_trigger function in the bpftrace binary, and offset 1781927 matches the END_trigger function (as can be verified by using readelf -s bpftrace).

The prog_id is the BPF program ID, which can be printed using the following subcommands.

bpftool prog show
The prog show subcommand lists all programs (not just those that are perf_event_open() based):

Click here to view code image


# bpftool prog show
[...]
232: kprobe  name END  tag b7cc714c79700b37  gpl
        loaded_at 2019-06-18T21:29:26+0000  uid 0
        xlated 168B  jited 138B  memlock 4096B  map_ids 130
233: kprobe  name BEGIN  tag 7de8b38ee40a4762  gpl
        loaded_at 2019-06-18T21:29:26+0000  uid 0
        xlated 120B  jited 112B  memlock 4096B  map_ids 130
234: kprobe  name blk_account_io_  tag d89dcf82fc3e48d8  gpl
        loaded_at 2019-06-18T21:29:26+0000  uid 0
        xlated 848B  jited 540B  memlock 4096B  map_ids 128,129
235: kprobe  name blk_account_io_  tag 499ff93d9cff0eb2  gpl
        loaded_at 2019-06-18T21:29:26+0000  uid 0
        xlated 176B  jited 139B  memlock 4096B  map_ids 128
[...]
258: cgroup_skb  tag 7be49e3934a125ba  gpl
        loaded_at 2019-06-18T21:31:27+0000  uid 0
        xlated 296B  jited 229B  memlock 4096B  map_ids 153,154
259: cgroup_skb  tag 2a142ef67aaad174  gpl
        loaded_at 2019-06-18T21:31:27+0000  uid 0
        xlated 296B  jited 229B  memlock 4096B  map_ids 153,154
262: kprobe  name trace_req_start  tag 1dfc28ba8b3dd597  gpl
        loaded_at 2019-06-18T21:37:51+0000  uid 0
        xlated 112B  jited 109B  memlock 4096B  map_ids 158
        btf_id 5
263: kprobe  name trace_req_done  tag d9bc05b87ea5498c  gpl
        loaded_at 2019-06-18T21:37:51+0000  uid 0
        xlated 912B  jited 567B  memlock 4096B  map_ids 158,157
        btf_id 5

This output shows the bpftrace program IDs (232 to 235) and the BCC program IDs (262 and 263), as well as other BPF programs that are loaded. Note that the BCC kprobe programs have BPF Type Format (BTF) information, shown by the presence of btf_id in this output. BTF is explained in more detail in Section 2.3.9. For now, it is sufficient to understand that BTF is a BPF version of debuginfo.

bpftool prog dump xlated
Each BPF program can be printed (“dumped”) via its ID. The xlated mode prints the BPF instructions translated to assembly. Here is program 234, the bpftrace block I/O done program10:

10 This may not match what the user loaded into the kernel, as the BPF verifier has the freedom to rewrite some instructions for optimization (e.g., inlining map lookups) or for security reasons (e.g., Spectre).

Click here to view code image


# bpftool prog dump xlated id 234
   0: (bf) r6 = r1
   1: (07) r6 += 112
   2: (bf) r1 = r10
   3: (07) r1 += -8
   4: (b7) r2 = 8
   5: (bf) r3 = r6
   6: (85) call bpf_probe_read#-51584
   7: (79) r1 = *(u64 *)(r10 -8)
   8: (7b) *(u64 *)(r10 -16) = r1
   9: (18) r1 = map[id:128]
  11: (bf) r2 = r10
  12: (07) r2 += -16
  13: (85) call __htab_map_lookup_elem#93808
  14: (15) if r0 == 0x0 goto pc+1
  15: (07) r0 += 56
  16: (55) if r0 != 0x0 goto pc+2
[...]

The output shows one of the restricted kernel helper calls that BPF can use: bpf_probe_read(). (More helper calls are listed in Table 2-2.)

Now compare the preceding output to the output for the BCC block I/O done program, ID 263, which has been compiled with BTF11:

11 This required LLVM 9.0, which includes BTF by default.

Click here to view code image


# bpftool prog dump xlated id 263
int trace_req_done(struct pt_regs * ctx):
; struct request *req = ctx->di;
   0: (79) r1 = *(u64 *)(r1 +112)
; struct request *req = ctx->di;
   1: (7b) *(u64 *)(r10 -8) = r1
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
   2: (18) r1 = map[id:158]
   4: (bf) r2 = r10
;
   5: (07) r2 += -8
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
   6: (85) call __htab_map_lookup_elem#93808
   7: (15) if r0 == 0x0 goto pc+1
   8: (07) r0 += 56
   9: (bf) r6 = r0
; if (tsp == 0) {
  10: (15) if r6 == 0x0 goto pc+101
; delta = bpf_ktime_get_ns() - *tsp;
  11: (85) call bpf_ktime_get_ns#88176
; delta = bpf_ktime_get_ns() - *tsp;
  12: (79) r1 = *(u64 *)(r6 +0)
[...]

This output now includes source information (highlighted in bold) from BTF. Note that it is a different program (different instructions and calls).

A linum modifier includes source file and line number information, also from BTF, if available (highlighted in bold):

Click here to view code image


# bpftool prog dump xlated id 263 linum
int trace_req_done(struct pt_regs * ctx):
; struct request *req = ctx->di; [file:/virtual/main.c line_num:42 line_col:29]
   0: (79) r1 = *(u64 *)(r1 +112)
; struct request *req = ctx->di; [file:/virtual/main.c line_num:42 line_col:18]
   1: (7b) *(u64 *)(r10 -8) = r1
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
[file:/virtual/main.c line_num:46 line_col:39]
   2: (18) r1 = map[id:158]
   4: (bf) r2 = r10
[...]

In this case, the line number information refers to the virtual files BCC creates when running programs.

An opcodes modifier includes the BPF instruction opcodes (highlighted in bold):

Click here to view code image


# bpftool prog dump xlated id 263 opcodes
int trace_req_done(struct pt_regs * ctx):
; struct request *req = ctx->di;
   0: (79) r1 = *(u64 *)(r1 +112)
       79 11 70 00 00 00 00 00
; struct request *req = ctx->di;
   1: (7b) *(u64 *)(r10 -8) = r1
       7b 1a f8 ff 00 00 00 00
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
   2: (18) r1 = map[id:158]
       18 11 00 00 9e 00 00 00 00 00 00 00 00 00 00 00
   4: (bf) r2 = r10
       bf a2 00 00 00 00 00 00
[...]

The BPF instruction opcodes are explained in Appendix E.

There is also a visual modifier, which emits control flow graph information in DOT format, for visualization by external software. For example, using GraphViz and its dot(1) directed graph tool [20]:

Click here to view code image


# bpftool prog dump xlated id 263 visual > biolatency_done.dot
$ dot -Tpng -Elen=2.5 biolatency_done.dot -o biolatency_done.png

The PNG file can then be viewed to see instruction flow. GraphViz provides different layout tools: I typically use dot(1), neato(1), fdp(1), and sfdp(1) for graphing DOT data. These tools allow various customizations (such as edge length: -Elen). Figure 2-5 shows the result of using osage(1) from GraphViz to visualize this BPF program.


Figure 2-5 BPF instruction flow visualized using GraphViz osage(1)

It is a complex program! Other GraphViz tools spread out the code blocks to prevent the bird’s nest of arrows but produce much larger files. If you need to read BPF instructions like this, you should experiment with the different tools to find the one that works best.

bpftool prog dump jited
The prog dump jited subcommand shows the machine code for the processor that is executed. This section shows x86_64; however, BPF has JITs for all major architectures supported by the Linux kernel. For the BCC block I/O done program:

Click here to view code image


# bpftool prog dump jited id 263
int trace_req_done(struct pt_regs * ctx):
0xffffffffc082dc6f:
; struct request *req = ctx->di;
   0:  push   %rbp
   1:  mov    %rsp,%rbp
   4:  sub    $0x38,%rsp
   b:  sub    $0x28,%rbp
   f:  mov    %rbx,0x0(%rbp)
  13:  mov    %r13,0x8(%rbp)
  17:  mov    %r14,0x10(%rbp)
  1b:  mov    %r15,0x18(%rbp)
  1f:  xor    %eax,%eax
  21:  mov    %rax,0x20(%rbp)
  25:  mov    0x70(%rdi),%rdi
; struct request *req = ctx->di;
  29:  mov    %rdi,-0x8(%rbp)
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
  2d:  movabs $0xffff96e680ab0000,%rdi
  37:  mov    %rbp,%rsi
  3a:  add    $0xfffffffffffffff8,%rsi
; tsp = bpf_map_lookup_elem((void *)bpf_pseudo_fd(1, -1), &req);
  3e:  callq  0xffffffffc39a49c1
[...]

As shown earlier, the presence of BTF for this program allows bpftool(8) to include the source lines; otherwise, they would not be present.

bpftool btf
bpftool(8) can also dump BTF IDs. For example, BTF ID 5 is for the BCC block I/O done program:

Click here to view code image


# bpftool btf dump id 5
[1] PTR '(anon)' type_id=0
[2] TYPEDEF 'u64' type_id=3
[3] TYPEDEF '__u64' type_id=4
[4] INT 'long long unsigned int' size=8 bits_offset=0 nr_bits=64 encoding=(none)
[5] FUNC_PROTO '(anon)' ret_type_id=2 vlen=4
        'pkt' type_id=1
        'off' type_id=2
        'bofs' type_id=2
        'bsz' type_id=2
[6] FUNC 'bpf_dext_pkt' type_id=5
[7] FUNC_PROTO '(anon)' ret_type_id=0 vlen=5
        'pkt' type_id=1
        'off' type_id=2
        'bofs' type_id=2
        'bsz' type_id=2
        'val' type_id=2
[8] FUNC 'bpf_dins_pkt' type_id=7
[9] TYPEDEF 'uintptr_t' type_id=10
[10] INT 'long unsigned int' size=8 bits_offset=0 nr_bits=64 encoding=(none)
[...]
[347] STRUCT 'task_struct' size=9152 vlen=204
        'thread_info' type_id=348 bits_offset=0
        'state' type_id=349 bits_offset=128
        'stack' type_id=1 bits_offset=192
        'usage' type_id=350 bits_offset=256
        'flags' type_id=28 bits_offset=288
[...]

This output shows that BTF includes type and struct information.

2.3.5 Viewing BPF Instructions: bpftrace
While tcpdump(8) can emit BPF instructions with -d, bpftrace can do so with -v12:

12 I just realized I should have made it -d for consistency.

Click here to view code image


# bpftrace -v biolatency.bt
Attaching 4 probes...

Program ID: 677

Bytecode:
0: (bf) r6 = r1
1: (b7) r1 = 29810
2: (6b) *(u16 *)(r10 -4) = r1
3: (b7) r1 = 1635021632
4: (63) *(u32 *)(r10 -8) = r1
5: (b7) r1 = 20002
6: (7b) *(u64 *)(r10 -16) = r1
7: (b7) r1 = 0
8: (73) *(u8 *)(r10 -2) = r1
9: (18) r7 = 0xffff96e697298800
11: (85) call bpf_get_smp_processor_id#8
12: (bf) r4 = r10
13: (07) r4 += -16
14: (bf) r1 = r6
15: (bf) r2 = r7
16: (bf) r3 = r0
17: (b7) r5 = 15
18: (85) call bpf_perf_event_output#25
19: (b7) r0 = 0
20: (95) exit
[...]

This output will also be printed if there is a bpftrace internal error. If you develop bpftrace internals, you may find it easy to run afoul of the BPF verifier, and have a program rejected by the kernel. At that point, these instructions will be printed out, and you will need to study them to determine the cause and develop the fix.

Most people will never encounter a bpftrace or BCC internal error and never see BPF instructions. If you do encounter such an issue, please file a ticket with the bpftrace or BCC projects, or consider contributing a fix yourself.

2.3.6 BPF API
To provide a better understanding of BPF capabilities, the following sections summarize selected parts of the extended BPF API, from include/uapi/linux/bpf.h in Linux 4.20.

BPF Helper Functions
A BPF program cannot call arbitrary kernel functions. To accomplish certain tasks with this limitation, “helper” functions that BPF can call have been provided. Selected functions are shown in Table 2-2.

Table 2-2 Selected BPF Helper Functions

BPF Helper Function

Description

bpf_map_lookup_elem(map, key)

Finds a key in a map and returns its value (pointer).

bpf_map_update_elem(map, key, value, flags)

Updates the value of the entry selected by key.

bpf_map_delete_elem(map, key)

Deletes the entry selected by key from the map.

bpf_probe_read(dst, size, src)

Safely reads size bytes from address src and stores in dst.

bpf_ktime_get_ns()

Returns the time since boot, in nanoseconds.

bpf_trace_printk(fmt, fmt_size, ...)

A debugging helper that writes to TraceFS trace{_pipe}.

bpf_get_current_pid_tgid()

Returns a u64 containing the current TGID (what user space calls the PID) in the upper bits and the current PID (what user space calls the kernel thread ID) in the lower bits.

bpf_get_current_comm(buf, buf_size)

Copies the task name to the buffer.

bpf_perf_event_output(ctx, map, data, size)

Writes data to the perf_event ring buffers; this is used for per-event output.

bpf_get_stackid(ctx, map, flags)

Fetches a user or kernel stack trace and returns an identifier.

bpf_get_current_task()

Returns the current task struct. This contains many details about the running process and links to other structs containing system state. Note that these are all considered an unstable API.

bpf_probe_read_str(dst, size, ptr)

Copies a NULL terminated string from an unsafe pointer to the destination, limited by size (including the NULL byte).

bpf_perf_event_read_value(map, flags, buf, size)

Reads a perf_event counter and stores it in the buf. This is a way to read PMCs during a BPF program.

bpf_get_current_cgroup_id()

Returns the current cgroup ID.

bpf_spin_lock(lock), bpf_spin_unlock(lock)

Concurrency control for network programs.

Some of these helper functions are shown in the earlier bpftool(8) xlated output, and bpftrace -v output.

The term current in these descriptions refers to the currently running thread—the thread that is currently on-CPU.

Note that the include/uapi/linux/bpf.h file often provides detailed documentation for these helpers. Here is an excerpt from bpf_get_stackid():

Click here to view code image


 * int bpf_get_stackid(struct pt_reg *ctx, struct bpf_map *map, u64 flags)
 *      Description
 *              Walk a user or a kernel stack and return its id. To achieve
 *              this, the helper needs *ctx*, which is a pointer to the context
 *              on which the tracing program is executed, and a pointer to a
 *              *map* of type **BPF_MAP_TYPE_STACK_TRACE**.
 *
 *              The last argument, *flags*, holds the number of stack frames to
 *              skip (from 0 to 255), masked with
 *              **BPF_F_SKIP_FIELD_MASK**. The next bits can be used to set
 *              a combination of the following flags:
 *
 *              **BPF_F_USER_STACK**
 *                      Collect a user space stack instead of a kernel stack.
 *              **BPF_F_FAST_STACK_CMP**
 *                      Compare stacks by hash only.
 *              **BPF_F_REUSE_STACKID**
 *                      If two different stacks hash into the same *stackid*,
 *                      discard the old one.
 *
 *              The stack id retrieved is a 32 bit long integer handle which
 *              can be further combined with other data (including other stack
 *              ids) and used as a key into maps. This can be useful for
 *              generating a variety of graphs (such as flame graphs or off-cpu
 *              graphs).
[...]

These files can be browsed online from any site that hosts the Linux source, for example: https://github.com/torvalds/linux/blob/master/include/uapi/linux/bpf.h.

There are many more helper functions available, mostly for software-defined networking. The current version of Linux (5.2) has 98 helper functions.

bpf_probe_read()
bpf_probe_read() is a particularly important helper. Memory access in BPF is restricted to BPF registers and the stack (and BPF maps via helpers). Arbitrary memory (such as other kernel memory outside of BPF) must be read via bpf_probe_read(), which performs safety checks and disables page faults to ensure that the reads do not cause faults from probe context (which could cause kernel problems).

Apart from reading kernel memory, this helper is also used to read user-space memory into kernel space. How this works depends on the architecture: On x86_64, the user and kernel address ranges do not overlap, so the mode can be determined by the address. This is not the case for other architectures, such as SPARC [21], and for BPF to support these other architectures it is anticipated that additional helpers will be required, such as bpf_probe_read_kernel() and bpf_probe_read_user().13

13 This need was raised by David S. Miller at LSFMM 2019.

BPF Syscall Commands
Table 2-3 shows selected BPF actions that user space can invoke.

Table 2-3 Selected BPF syscall Commands

bpf_cmd

Description

BPF_MAP_CREATE

Creates a BPF map: a flexible storage object that can be used as a key/value hash table (associative array).

BPF_MAP_LOOKUP_ELEM

Looks up an element via a key.

BPF_MAP_UPDATE_ELEM

Updates an element, given a key.

BPF_MAP_DELETE_ELEM

Deletes an element, given a key.

BPF_MAP_GET_NEXT_KEY

Iterates over all keys in a map.

BPF_PROG_LOAD

Verifies and loads a BPF program.

BPF_PROG_ATTACH

Attaches a BPF program to an event.

BPF_PROG_DETACH

Detaches a BPF program from an event.

BPF_OBJ_PIN

Creates a BPF object instance in /sys/fs/bpf.

These actions are passed as the first argument to the bpf(2) syscall. You can see them in action by using strace(1). For example, inspecting the bpf(2) syscalls made when running the BCC execsnoop(8) tool:

Click here to view code image


# strace -ebpf execsnoop
bpf(BPF_MAP_CREATE, {map_type=BPF_MAP_TYPE_PERF_EVENT_ARRAY, key_size=4,
value_size=4, max_entries=8, map_flags=0, inner_map_fd=0, ...}, 72) = 3
bpf(BPF_PROG_LOAD, {prog_type=BPF_PROG_TYPE_KPROBE, insn_cnt=513,
insns=0x7f31c0a89000, license="GPL", log_level=0, log_size=0, log_buf=0,
kern_version=266002, prog_flags=0, ...}, 72) = 4
bpf(BPF_PROG_LOAD, {prog_type=BPF_PROG_TYPE_KPROBE, insn_cnt=60,
insns=0x7f31c0a8b7d0, license="GPL", log_level=0, log_size=0, log_buf=0,
kern_version=266002, prog_flags=0, ...}, 72) = 6
PCOMM            PID    PPID   RET ARGS
bpf(BPF_MAP_UPDATE_ELEM, {map_fd=3, key=0x7f31ba81e880, value=0x7f31ba81e910,
flags=BPF_ANY}, 72) = 0
bpf(BPF_MAP_UPDATE_ELEM, {map_fd=3, key=0x7f31ba81e910, value=0x7f31ba81e880,
flags=BPF_ANY}, 72) = 0
[...]

Actions are highlighted in bold in this output. Note that I normally avoid using strace(1) as its current ptrace() implementation can greatly slow the target process—by over 100-fold [22]. I used it here because it already has translation mappings for the bpf(2) syscall, turning numbers into readable strings (e.g., “BPF_PROG_LOAD”).

BPF Program Types
Different BPF program types specify the type of events that the BPF program attaches to, and the arguments for the events. The main program types used for BPF tracing programs are shown in Table 2-4.

Table 2-4 BPF Tracing Program Types

bpf_prog_type

Description

BPF_PROG_TYPE_KPROBE

For kprobes and uprobes

BPF_PROG_TYPE_TRACEPOINT

For tracepoints

BPF_PROG_TYPE_PERF_EVENT

For perf_events, including PMCs

BPF_PROG_TYPE_RAW_TRACEPOINT

For tracepoints, without argument processing

The earlier strace(1) output included two BPF_PROG_LOAD calls of type BPF_PROG_TYPE_KPROBE, as that version of execsnoop(8) is using a kprobe and a kretprobe for instrumenting the beginning and end of execve().

There are more program types in bpf.h for networking and other purposes, including those shown in Table 2-5.

Table 2-5 Selected Other BPF Program Types

bpf_prog_type

Description

BPF_PROG_TYPE_SOCKET_FILTER

For attaching to sockets, the original BPF use case

BPF_PROG_TYPE_SCHED_CLS

For traffic control classification

BPF_PROG_TYPE_XDP

For eXpress Data Path programs

BPF_PROG_TYPE_CGROUP_SKB

For cgroup packet (skb) filters

BPF Map Types
BPF map types, some of which are listed in Table 2-6, define different types of maps.

Table 2-6 Selected BPF Map Types

bpf_map_type

Description

BPF_MAP_TYPE_HASH

A hash-table map: key/value pairs

BPF_MAP_TYPE_ARRAY

An array of elements

BPF_MAP_TYPE_PERF_EVENT_ARRAY

An interface to the perf_event ring buffers for emitting trace records to user space

BPF_MAP_TYPE_PERCPU_HASH

A faster hash table maintained on a per-CPU basis

BPF_MAP_TYPE_PERCPU_ARRAY

A faster array maintained on a per-CPU basis

BPF_MAP_TYPE_STACK_TRACE

Storage for stack traces, indexed by stack IDs

BPF_MAP_TYPE_STACK

Storage for stack traces

The earlier strace(1) output included a BPF_MAP_CREATE of type BPF_MAP_TYPE_PERF_EVENT_ARRAY, which was used by execsnoop(8) for passing events to user space for printing.

There are many more map types in bpf.h for special purposes.

2.3.7 BPF Concurrency Controls
BPF lacked concurrency controls until Linux 5.1, when spin lock helpers were added. (However, they are not yet available for use in tracing programs.) With tracing, parallel threads can look up and update BPF map fields in parallel, causing corruption where one thread overwrites the update from another. This is also known as the “lost update” problem where concurrent reads and writes overlap, causing lost updates. The tracing front ends, BCC and bpftrace, use the per-CPU hash and array map types where possible to avoid this corruption. They create instances for each logical CPU to use, preventing parallel threads from updating a shared location. A map that counts events, for example, can be updated as a per-CPU map, and then the per-CPU values can be combined when needed for the total count.

As a specific example, this bpftrace one-liner uses a per-CPU hash for counting:

Click here to view code image


# strace -febpf bpftrace -e 'k:vfs_read { @ = count(); }'
bpf(BPF_MAP_CREATE, {map_type=BPF_MAP_TYPE_PERCPU_HASH, key_size=8, value_size=8,
max_entries=128, map_flags=0, inner_map_fd=0}, 72) = 3
[...]

And this bpftrace one-liner uses a normal hash for counting:

Click here to view code image


# strace -febpf bpftrace -e 'k:vfs_read { @++; }'
bpf(BPF_MAP_CREATE, {map_type=BPF_MAP_TYPE_HASH, key_size=8, value_size=8,
max_entries=128, map_flags=0, inner_map_fd=0}, 72) = 3
[...]

Using them both at the same time on an eight-CPU system, and tracing a function that is frequent and may run in parallel:

Click here to view code image


# bpftrace -e 'k:vfs_read { @cpuhash = count(); @hash++; }'
Attaching 1 probe...
^C

@cpuhash: 1061370
@hash: 1061269

A comparison of the counts reveals that the normal hash undercounted events by 0.01%.

Apart from per-CPU maps, there are also other mechanisms for concurrency controls, including an exclusive add instruction (BPF_XADD), a map in map that can update entire maps atomically, and BPF spin locks. Regular hash and LRU map updates via bpf_map_update_elem() are atomic as well and free from data races due to concurrent writes. Spin locks, which were added in Linux 5.1, are controlled by the bpf_spin_lock() and bpf_spin_unlock() helpers [23].

2.3.8 BPF sysfs Interface
In Linux 4.4, BPF introduced commands to expose BPF programs and maps via a virtual file system, conventionally mounted on /sys/fs/bpf. This capability, termed “pinning,” has a number of uses. It allows the creation of BPF programs that are persistent (much like daemons) and continue running after the process that loaded them has exited. It also provides another way for user-level programs to interact with a running BPF program: They can read from and write to BPF maps.

Pinning has not been used by the BPF observability tools in this book, which are modeled after standard Unix utilities that start and stop. However, any of these tools could be converted to one that is pinned, if needed. This is more commonly used for networking programs (e.g., the Cilium software [24]).

As an example of pinning, the Android operating system makes use of pinning to automatically load and pin BPF programs found under /system/etc/bpf [25]. Android library functions are provided to interact with these pinned programs.

2.3.9 BPF Type Format (BTF)
One of the recurring issues described in this book is the lack of information about the source code that is instrumented, making it difficult to write BPF tools. As will be mentioned many times, an ideal solution to these problems is BTF, introduced here.

BTF (BPF Type Format) is a metadata format that encodes debugging information for describing BPF programs, BPF maps, and much more. The name BTF was chosen as it initially described data types; however, it was later extended to include function info for defined subroutines, line info for source/line information, and global variable information.

BTF debug info can be embedded in the vmlinux binary or generated together with BPF programs with native Clang compilation or LLVM JIT, so that the BPF program can be inspected more easily with loaders (e.g., libbpf) and tools (e.g., bpftool(8)). Inspection and tracing tools, including bpftool(8) and perf(1), can retrieve such info to provide source annotated BPF programs, or pretty print map key/values based on their C structure instead of a raw hex dump. The previous examples of bpftool(8) dumping an LLVM-9 compiled BCC program demonstrate this.

Apart from describing BPF programs, BTF is becoming a general-purpose format for describing all kernel data structures. In some ways, it is becoming a lightweight alternative to kernel debuginfo for use by BPF, and a more complete and reliable alternative to kernel headers.

BPF tracing tools often require kernel headers to be installed (usually via a linux-headers package) so that various C structs can be navigated. These headers do not contain definitions for all the structs in the kernel, making it difficult to develop some BPF observability tools: missing structs need to be defined in the BPF tool source as a workaround. There have also been issues with complex headers not being processed correctly; bpftrace may switch to aborting in these cases rather than continuing with potentially incorrect struct offsets. BTF can solve this problem by providing reliable definitions for all structs. (An earlier bpftool btf output shows how task_struct can be included.) In the future, a shipped Linux kernel vmlinux binary that contains BTF will be self-describing.

BTF is still in development at the time of writing this book. In order to support a compile-once-run-everywhere initiative, more information is to be added to BTF. For the latest on BTF, see Documentation/bpf/btf.rst in the kernel source [26].

2.3.10 BPF CO-RE
The BPF Compile Once - Run Everywhere (CO-RE) project aims to allow BPF programs to be compiled to BPF bytecode once, saved, and then distributed and executed on other systems. This will avoid the need to have BPF compilers installed everywhere (LLVM and Clang), which can be challenging for space-constrained embedded Linux. It will also avoid the runtime CPU and memory costs of running a compiler whenever a BPF observability tool is executed.

The CO-RE project, and developer Andrii Nakryiko, are working through challenges such as coping with different kernel struct offsets on different systems, which require field offsets in BPF bytecode to be rewritten as needed. Another challenge is missing struct members, which requires field access to be conditional based on the kernel version, kernel configuration, and/or user-provided runtime flags. The CO-RE project will make use of BTF information, and is still in development at the time of writing this book.

2.3.11 BPF Limitations
BPF programs cannot call arbitrary kernel functions; they are limited to the BPF helper functions listed in the API. More may be added in future kernel versions as needs arise. BPF programs also impose limits on loops: It would be unsafe to allow BPF programs to insert infinite loops on arbitrary kprobes, as those threads may be holding critical locks that block the rest of the system. Workarounds involve unrolling loops, and adding helper functions for common uses that need loops. Linux 5.3 included support for bounded loops in BPF, which have a verifiable upper runtime limit.14

14 You may begin wondering if BPF will become Turing complete. The BPF instruction set itself allows for the creation of a Turing complete automata, but given the safety restrictions the verifier puts in place, the BPF programs are not Turing complete anymore (e.g., due to the halting problem).

The BPF stack size is limited to MAX_BPF_STACK, set to 512. This limit is sometimes encountered when writing BPF observability tools, especially when storing multiple string buffers on the stack: a single char[256] buffer consumes half this stack. There are no plans to increase this limit. The solution is to instead use BPF map storage, which is effectively infinite. Work has begun to switch bpftrace strings to use map storage instead of stack storage.

The number of instructions in a BPF program was initially limited to 4096. Long BPF programs sometimes encounter this limit (they would encounter it much sooner without LLVM compiler optimizations, which reduce the instruction count.) Linux 5.2 greatly increased the limit such that it should no longer be an issue.15 The aim of the BPF verifier is to accept any safe program, and the limits should not get in the way.

15 The limit was changed to one million instructions (BPF_COMPLEXITY_LIMIT_INSNS) [27]. The 4096 limit (BPF_MAXINSNS) still remains for unprivileged BPF programs [28].

2.3.12 BPF Additional Reading
More sources for understanding extended BPF:

Documentation/networking/filter.txt in the kernel source [17]

Documentation/bpf/bpf_design_QA.txt in the kernel source [29]

The bpf(2) man page [30]

The bpf-helpers(7) man page [31]

“BPF: the universal in-kernel virtual machine” by Jonathan Corbet [32]

“BPF Internals—II” by Suchakra Sharma [33]

“BPF and XDP Reference Guide” by Cilium [19]

Additional examples of BPF programs are provided in Chapter 4 and in Appendixes C, D, and E.

2.4 STACK TRACE WALKING
Stack traces are an invaluable tool for understanding the code path that led to an event, as well as profiling kernel and user code to observe where execution time is spent. BPF provides special map types for recording stack traces and can fetch them using frame pointer–based or ORC-based stack walks. BPF may support other stack walking techniques in the future.

2.4.1 Frame Pointer–Based Stacks
The frame pointer technique follows a convention where the head of a linked list of stack frames can always be found in a register (RBP on x86_64) and where the return address is stored at a known offset (+8) from the stored RBP [Hubicka 13]. This means that any debugger or tracer that interrupts the program can read RBP and then easily fetch the stack trace by walking the RBP linked list and fetching the addresses at the known offset. This is shown in Figure 2-6.


Figure 2-6 Frame pointer–based stack walking (x86_64)

The AMD64 ABI notes that the use of RBP as a frame pointer register is conventional, and can be avoided to save function prologue and epilogue instructions, and to make RBP available as a general-purpose register.

The gcc compiler currently defaults to omitting the frame pointer and using RBP as a general-purpose register, which breaks frame pointer-based stack walking. This default can be reverted using the -fno-omit-frame-pointer option. Three details from the patch that introduced frame pointer omission as the default explain why it was done [34]:

The patch was introduced for i386, which has four general-purpose registers. Freeing RBP increases the usable registers from four to five, leading to significant performance wins. For x86_64, however, there are already 16 usable registers, making this change much less worthwhile. [35].

It was assumed that stack walking was a solved problem, thanks to gdb(1) support of other techniques. This does not account for tracer stack walking, which runs in limited context with interrupts disabled.

The need to compete on benchmarks with Intel’s icc compiler.

On x86_64 today, most software is compiled with gcc’s defaults, breaking frame pointer stack traces. Last time I studied the performance gain from frame pointer omission in our production environment, it was usually less than one percent, and it was often so close to zero that it was difficult to measure. Many microservices at Netflix are running with the frame pointer reenabled, as the performance wins found by CPU profiling outweigh the tiny loss of performance.

Using frame pointers is not the only way to walk a stack; other methods include debuginfo, LBR, and ORC.

2.4.2 debuginfo
Additional debugging information is often available for software as debuginfo packages, which contain ELF debuginfo files in the DWARF format. These include sections that debuggers such as gdb(1) can use to walk the stack trace, even when no frame pointer register is in use. The ELF sections are .eh_frame and .debug_frame.

Debuginfo files also include sections containing source and line number information, resulting in files that dwarf (ahem) the original binary that is debugged. An example in Chapter 12 shows libjvm.so at 17 Mbytes, and its debuginfo file at 222 Mbytes. In some environments, debuginfo files are not installed due to their large size.

BPF does not currently support this technique of stack walking: It is processor intensive and requires reading ELF sections that may not be faulted in. This makes it challenging to implement in the limited interrupt-disabled BPF context.

Note that the BPF front ends BCC and bpftrace do support debuginfo files for symbol resolution.

2.4.3 Last Branch Record (LBR)
Last branch record is an Intel processor feature to record branches in a hardware buffer, including function call branches. This technique has no overhead and can be used to reconstruct a stack trace. However, it is limited in depth depending on the processor, and may only support recording 4 to 32 branches. Stack traces for production software, especially Java, can exceed 32 frames.

LBR is not currently supported by BPF, but it may be in the future. A limited stack trace is better than no stack trace!

2.4.4 ORC
A new debug information format that has been devised for stack traces, Oops Rewind Capability (ORC), is less processor intensive than DWARF [36]. ORC uses .orc_unwind and .orc_unwind_ip ELF sections, and it has so far been implemented for the Linux kernel. On register-limited architectures, it may be desirable to compile the kernel without the frame pointer and use ORC for stack traces instead.

ORC stack unwinding is available in the kernel via the perf_callchain_kernel() function, which BPF calls. This means BPF also supports ORC stack traces. ORC stacks have not yet been developed for user space.

2.4.5 Symbols
Stack traces are currently recorded in the kernel as an array of addresses that are later translated to symbols (such as function names) by a user-level program. There can be situations where symbol mappings have changed between collection and translation, resulting in invalid or missing translations. This is discussed in Section 12.3.4 in Chapter 12. Possible future work includes adding support for symbol translation in the kernel, so that the kernel can collect and translate a stack trace immediately.

2.4.6 More Reading
Stack traces and frame pointers are discussed further in Chapter 12 for C and Java, and Chapter 18 provides a general summary.

2.5 FLAME GRAPHS
Flame graphs are frequently used in later chapters of this book, so this section summarizes how to use and read them.

Flame graphs are visualizations of stack traces that I invented when working on a MySQL performance issue and while trying to compare two CPU profiles that were thousands of pages of text [Gregg 16].16 Apart from CPU profiles, they can also be used to visualize recorded stack traces from any profiler or tracer. Later in this book I show them applied to BPF tracing of off-CPU events, page faults, and more. This section explains the visualization.

16 Inspiration for the general layout, SVG output, and JavaScript interactivity came from Neelakanth Nadgir’s function_call_graph.rb time-ordered visualization for callstacks, which itself was inspired by Roch Bourbonnais’s CallStackAnalyzer and Jan Boerhout’s vftrace.

2.5.1 Stack Trace
A stack trace, also called a stack back trace or a call trace, is a series of functions that show the flow of code. For example, if func_a() called func_b(), which called func_c(), the stack trace at that point may be written as:

Click here to view code image


func_c
func_b
func_a

The bottom of the stack (func_a) is the origin, and the lines above it show the code flow. Put differently, the top of the stack (func_c) is the current function, and moving downwards shows its ancestry: parent, then grandparent, and so on.

2.5.2 Profiling Stack Traces
Timed sampling of stack traces can collect thousands of stacks that can be tens or hundreds of lines long each. To make this volume of data easier to study, the Linux perf(1) profiler summarizes stack samples as a call tree, and shows percentages for each path. The BCC profile(8) tool summarizes stack traces in a different way, showing a count for each unique stack trace. Real-world examples of both perf(1) and profile(8) are provided in Chapter 6. With both tools, pathological issues can be identified quickly for situations when a lone stack is on-CPU for the bulk of the time. However, for many other issues, including small performance regressions, finding the culprit can involve studying hundreds of pages of profiler output. Flame graphs were created to solve this problem.

To understand flame graphs, consider this synthetic example of CPU profiler output, showing a frequency count of stack traces:

Click here to view code image


func_e
func_d
func_b
func_a
1

func_b
func_a
2

func_c
func_b
func_a
7

This output shows a stack trace followed by a count, for a total of 10 samples. The code path in func_a() -> func_b() -> func_c(), for example, was sampled seven times. That code path shows func_c() running on CPU. The func_a() -> func_b() code path, with func_b() running on CPU, was sampled twice. And a code path that ends with func_e() running on CPU was sampled once.

2.5.3 Flame Graph
Figure 2-7 shows a flame graph representation of the previous profile.


Figure 2-7 A Flame Graph

This flame graph has the following properties:

Each box represents a function in the stack (a “stack frame”).

The y-axis shows stack depth (the number of frames on the stack), ordered from root at the bottom to leaf at the top. Looking from the bottom up, you can understand the code flow; from the top down, you can determine the function ancestry.

The x-axis spans the sample population. It’s important to note that it does not show the passage of time from left to right, as most graphs do. The left-to-right ordering is instead an alphabetical sort of frames to maximize frame merging. With the y-axis ordering of frames, this means that the graph origin is the bottom left (as with most graphs) and represents 0,a. The length across the x-axis does have meaning: The width of the box reflects its presence in the profile. Functions with wide boxes are more present in the profile than those with narrow boxes.

The flame graph is really an adjacency diagram with an inverted icicle layout [Bostock 10], applied to visualize the hierarchy of a collection of stack traces.

The most frequent stack in Figure 2-7 is seen in the profile as the widest “tower” in the middle, from func_a() to func_c(). Since this is a flame graph showing CPU samples, we can describe the top edge as the functions that were running on-CPU, as highlighted in Figure 2-8.


Figure 2-8 CPU Flame Graph of on-CPU Functions

Figure 2-8 shows that func_c() was directly on-CPU for 70% of the time, func_b() was on-CPU for 20% of the time, and func_e() was on-CPU for 10% of the time. The other functions, func_a() and func_d(), were never sampled on-CPU directly.

To read a flame graph, look for the widest towers and understand them first.

For large profiles of thousands of samples, there may be code paths that were sampled only a few times, and are printed in such a narrow tower that there is no room to include the function name. This turns out to be a benefit: Your attention is naturally drawn to the wider towers that have legible function names, and looking at them helps you understand the bulk of the profile first.

2.5.4 Flame Graph Features
My original flame graph implementation supports the features described in the following sections [37].

Color Palettes
The frames can be colored based on different schemes. The default is to use random warm colors for each frame, which helps visually distinguish adjacent towers. Over the years I’ve added more color schemes. I’ve found the following to be most useful to flame graph end users:

Hue: The hue indicates the code type.17 For example, red can indicate native user-level code, orange for native kernel-level code, yellow for C++, green for interpreted functions, aqua for inlined functions, and so on depending on the languages you use. Magenta is used to highlight search matches. Some developers have customized flame graphs to always highlight their own code in a certain hue, so that it stands out.

17 This was suggested to me by my colleague Amer Ather. My first version was a five-minute regex hack.

Saturation: Saturation is hashed from the function name. It provides some color variance that helps differentiate adjacent towers, while preserving the same colors for function names to more easily compare multiple flame graphs.

Background color: The background color provides a visual reminder of the flame graph type. For example, you might use yellow for CPU flame graphs, blue for off-CPU or I/O flame graphs, and green for memory flame graphs.

Another useful color scheme is one used for IPC (instructions per cycle) flame graphs, where an additional dimension, IPC, is visualized by coloring each frame using a gradient from blue to white to red.

Mouse-Overs
The original flame graph software creates SVG files with embedded JavaScript that can be loaded in a browser for interactive features. One such feature is that on mouse-over of frames, an information line is revealed, showing the percentage occurrence of that frame in the profile.

Zoom
Frames can be clicked for a horizontal zoom.18 This allows narrow frames to be inspected, zooming in to show their function names.

18 Adrien Mahieux developed the horizontal zoom feature for flame graphs.

Search
A search button, or Ctrl-F, allows a search term to be entered, and then frames matching that search term are highlighted in magenta. A cumulative percentage is also shown to indicate how often a stack trace containing that search term was present. This makes it trivial to calculate how much of the profile was in particular code areas. For example, you can search for “tcp_” to show how much was in the kernel TCP code.

2.5.5 Variations
A more interactive version of flame graphs is under development at Netflix, using d3 [38].19 It is open source and used in the Netflix FlameScope software [39].

19 d3 flame graphs was created by my colleague Martin Spier.

Some flame graph implementations flip the y-axis order by default, creating an “icicle graph” with the root at the top. This inversion ensures that the root and its immediate functions are still visible for flame graphs that are taller than the screen height and when displaying from the flame graph top to begin with. My original flame graph software supports this inversion with --inverted. My own preference is to reserve this icicle layout for leaf-to-root merging, another flame graph variant that merges from the leaves first and roots last. This is useful for merging a common on-CPU function first and then seeing its ancestry, for example: spin locks.

Flame charts appear similar to flame graphs and were inspired by flame graphs [ Tikhonovsky 13], but the x-axis is ordered based on the passage of time rather than the alphabet. Flame charts are popular in web browser analysis tools for the inspection of JavaScript, as they are suited for understanding time-based patterns in single-threaded applications. Some profiling tools support both flame graphs and flame charts.

Differential flame graphs show the differences between two profiles.20

20 Cor-Paul Bezemer researched differential flame graphs and developed the first solution [Bezemer 15].

2.6 EVENT SOURCES
The different event sources and examples of events that can be instrumented are illustrated in Figure 2-9. This figure also shows the Linux kernel versions that BPF supported attaching to these events.


Figure 2-9 BPF event support

These event sources are explained in the following sections.

2.7 KPROBES
kprobes provide kernel dynamic instrumentation, and were developed by a team at IBM based on their DProbes tracer in 2000. However, DProbes did not get merged into the Linux kernel, while kprobes did. kprobes arrived in Linux 2.6.9, which was released in 2004.

kprobes can create instrumentation events for any kernel function, and it can instrument instructions within functions. It can do this live, in production environments, without needing to either reboot the system or run the kernel in any special mode. This is an amazing capability: It means we can instrument any of the tens of thousands of kernel functions in Linux to create new custom metrics as needed.

The kprobes technology also has an interface called kretprobes for instrumenting when functions return, and their return values. When kprobes and kretprobes instrument the same function, timestamps can be recorded to calculate the duration of a function, which can be an important metric for performance analysis.

2.7.1 How kprobes Work
The sequence for instrumenting a kernel instruction with kprobes is [40]:

If it is a kprobe:

Bytes from the target address are copied and saved by kprobes (enough bytes to span their replacement with a breakpoint instruction).

The target address is replaced with a breakpoint instruction: int3 on x86_64. (If kprobe optimization is possible, the instruction is jmp.)

When instruction flow hits this breakpoint, the breakpoint handler checks whether the breakpoint was installed by kprobes, and, if it was, executes a kprobe handler.

The original instructions are then executed, and instruction flow resumes.

When the kprobe is no longer needed, the original bytes are copied back to the target address, and the instructions are restored to their original state.

If it is a kprobe for an address that Ftrace already instruments (usually function entries), an Ftrace-based kprobe optimization may be possible, where [Hiramatsu 14]:

An Ftrace kprobe handler is registered as an Ftrace operation for the traced function.

The function executes its built-in call in the function prologue (__fentry__ with gcc 4.6+ and x86), which calls in to Ftrace. Ftrace calls the kprobe handler, and then returns to executing the function.

When the kprobe is no longer needed, the Ftrace-kprobe handler is removed from Ftrace.

If it is a kretprobe:

A kprobe is created for the entry to the function.

When the function entry kprobe is hit, the return address is saved and then replaced with a substitute (“trampoline”) function: kretprobe_trampoline().

When the function finally calls return (e.g., the ret instruction), the CPU passes control to the trampoline function, which executes the kretprobe handler.

The kretprobe handler finishes by returning to the saved return address.

When the kretprobe is no longer needed, the kprobe is removed.

The kprobe handlers may run with preemption disabled or interrupts disabled, depending on the architecture and other factors.

Modifying kernel instruction text live may sound incredibly risky, but it has been designed to be safe. This design includes a blacklist of functions that kprobe will not instrument, which include kprobes itself, to avoid a recursive trap condition.21 kprobes also make use of safe techniques for inserting breakpoints: the x86 native int3 instruction, or stop_machine() when the jmp instruction is used to ensure that other cores do not execute instructions as they are being modified. The biggest risk in practice is instrumenting a kernel function that is extremely frequent: if that happens, the small overhead added to each invocation can add up, slowing down the system while the function is instrumented.

21 You can exclude kernel functions from tracing by listing them with the NOKPROBE_SYMBOL() macro.

kprobes does not work on some ARM 64-bit systems where modifications to the kernel text section are not allowed for security reasons.

2.7.2 kprobes Interfaces
The original kprobes technology was used by writing a kernel module that defined pre- and post-handlers written in C and registering them with a kprobe API call: register_kprobe(). You could then load your kernel module and emit custom information via system messages with calls to printk(). You needed to call unregister_kprobe() when you were done.

I have not seen anyone use this interface directly, other than in the 2010 article “Kernel instrumentation using kprobes” from Phrack, a security ezine, written by a researcher using the handle ElfMaster22 [41]. That may not be a failure of kprobes, since it was built to be used from Dprobes in the first place. Nowadays, there are three interfaces for using kprobes:

22 In an unplanned coincidence, three days after writing this sentence I met ElfMaster, and he taught me many details about ELF analysis. These include how ELF tables are stripped, which I summarize in Chapter 4.

kprobe API: register_kprobe() etc.

Ftrace-based, via /sys/kernel/debug/tracing/kprobe_events: where kprobes can be enabled and disabled by writing configuration strings to this file

perf_event_open(): as used by the perf(1) tool, and more recently by BPF tracing, as support was added in the Linux 4.17 kernel (perf_kprobe pmu)

The biggest use of kprobes has been via front-end tracers, including perf(1), SystemTap, and the BPF tracers BCC and bpftrace.

The original kprobes implementation also had a variant called jprobes, an interface designed for tracing kernel function entry. Over time, we have come to understand that kprobes can meet all requirements, and the jprobes interface was unnecessary. It was removed from Linux in 2018 by Masami Hiramatsu, a kprobe maintainer.

2.7.3 BPF and kprobes
kprobes provides kernel dynamic instrumentation for BCC and bpftrace, and it is used by numerous tools. The interfaces are:

BCC: attach_kprobe() and attach_kretprobe()

bpftrace: kprobe and kretprobe probe types

The kprobe interface in BCC supports instrumenting the beginning of a function and a function plus instruction offset, whereas bpftrace currently supports instrumenting the beginning of a function only. The kretprobe interface for both tracers instruments the return of the function.

As an example from BCC, the vfsstat(8) tool instruments key calls to the virtual file system (VFS) interface, and prints per-second summaries:

Click here to view code image


# vfsstat
TIME         READ/s  WRITE/s CREATE/s   OPEN/s  FSYNC/s
07:48:16:       736     4209        0       24        0
07:48:17:       386     3141        0       14        0
07:48:18:       308     3394        0       34        0
07:48:19:       196     3293        0       13        0
07:48:20:      1030     4314        0       17        0
07:48:21:       316     3317        0       98        0
[...]

The probes traced can be seen in the source to vfsstat:

Click here to view code image


# grep attach_ vfsstat.py
b.attach_kprobe(event="vfs_read", fn_name="do_read")
b.attach_kprobe(event="vfs_write", fn_name="do_write")
b.attach_kprobe(event="vfs_fsync", fn_name="do_fsync")
b.attach_kprobe(event="vfs_open", fn_name="do_open")
b.attach_kprobe(event="vfs_create", fn_name="do_create")

These are attach_kprobe() functions. The kernel functions can be seen after the “event=” assignment.

As an example from bpftrace, this one-liner counts the invocations of all the VFS functions, by matching “vfs_*”:

Click here to view code image


# bpftrace -e 'kprobe:vfs_* { @[probe] = count() }'
Attaching 54 probes...
^C

@[kprobe:vfs_unlink]: 2
@[kprobe:vfs_rename]: 2
@[kprobe:vfs_readlink]: 2
@[kprobe:vfs_statx]: 88
@[kprobe:vfs_statx_fd]: 91
@[kprobe:vfs_getattr_nosec]: 247
@[kprobe:vfs_getattr]: 248
@[kprobe:vfs_open]: 320
@[kprobe:vfs_writev]: 441
@[kprobe:vfs_write]: 4977
@[kprobe:vfs_read]: 5581

This output shows that while tracing, the vfs_unlink() function was called twice, and the vfs_read() function was called 5581 times.

The ability to pull call counts from any kernel function is a useful capability, and can be used for workload characterization of kernel subsystems.23

23 At the time of writing, I still tend to use Ftrace for this particular task, since it is quicker to initialize and tear down instrumentation. See my funccount(8) tool from my Ftrace perf-tools repository. As of this writing, there is work under way to improve the speed of BPF kprobe initialization and teardown by batching operations. I hope it will be available by the time you are reading this.

2.7.4 kprobes Additional Reading
More sources for understanding kprobes:

Documentation/kprobes.txt in the Linux kernel source [42]

“An Introduction to kprobes” by Sudhanshu Goswami [40]

“Kernel Debugging with kprobes” by Prasanna Panchamukhi [43]

2.8 UPROBES
uprobes provides user-level dynamic instrumentation. Work began many years earlier, with a utrace interface similar to the kprobes interface. This eventually became the uprobes technology that was merged in the Linux 3.5 kernel, released in July 2012 [44].

uprobes are similar to kprobes, but for user-space processes. uprobes can instrument user-level function entries as well as instruction offsets, and uretprobes can instrument the return of functions.

uprobes are also file based: When a function in an executable file is traced, all processes using that file are instrumented, including those that start in the future. This allows library calls to be traced system-wide.

2.8.1 How uprobes Work
uprobes is similar to kprobes in its approach: A fast breakpoint is inserted at the target instruction, and it passes execution to a uprobe handler. When the uprobe is no longer needed, the target instructions are returned to their original state. With uretprobes, the function entry is instrumented with a uprobe, and the return address is hijacked with a trampoline function, as with kprobes.

You can see this in action by using a debugger. For example, disassembling the readline() function from the bash(1) shell:

Click here to view code image


# gdb -p 31817
[...]
(gdb) disas readline
Dump of assembler code for function readline:
   0x000055f7fa995610 <+0>:  cmpl   $0xffffffff,0x2656f9(%rip) # 0x55f7fabfad10
<rl_pending_input>
   0x000055f7fa995617 <+7>:  push   %rbx
   0x000055f7fa995618 <+8>:  je     0x55f7fa99568f <readline+127>
   0x000055f7fa99561a <+10>: callq  0x55f7fa994350 <rl_set_prompt>
   0x000055f7fa99561f <+15>: callq  0x55f7fa995300 <rl_initialize>
   0x000055f7fa995624 <+20>: mov    0x261c8d(%rip),%rax        # 0x55f7fabf72b8
<rl_prep_term_function>
   0x000055f7fa99562b <+27>: test   %rax,%rax
[...]

And now while it is instrumented using uprobes (or uretprobes):

Click here to view code image


# gdb -p 31817
[...]
(gdb) disas readline
Dump of assembler code for function readline:
   0x000055f7fa995610 <+0>:  int3
   0x000055f7fa995611 <+1>:  cmp    $0x2656f9,%eax
   0x000055f7fa995616 <+6>:  callq  *0x74(%rbx)
   0x000055f7fa995619 <+9>:  jne    0x55f7fa995603 <rl_initialize+771>
   0x000055f7fa99561b <+11>: xor    %ebp,%ebp
   0x000055f7fa99561d <+13>: (bad)
   0x000055f7fa99561e <+14>: (bad)
   0x000055f7fa99561f <+15>: callq  0x55f7fa995300 <rl_initialize>
   0x000055f7fa995624 <+20>: mov    0x261c8d(%rip),%rax        # 0x55f7fabf72b8
<rl_prep_term_function>
[...]

Note that the first instruction has become the int3 breakpoint (x86_64).

To instrument the readline() function, I used a bpftrace one-liner:

Click here to view code image


# bpftrace -e 'uprobe:/bin/bash:readline { @ = count() }'
Attaching 1 probe...
 ^C

@: 4

This counts the invocations of readline() in all running and future bash shells invoked while tracing, and prints the count and exits on Ctrl-C. When bpftrace stops running, the uprobe is removed, and the original instructions are restored.

2.8.2 Uprobes Interfaces
There are two interfaces for uprobes:

Ftrace-based, via /sys/kernel/debug/tracing/uprobe_events: where uprobes can be enabled and disabled by writing configuration strings to this file

perf_event_open(): as used by the perf(1) tool and, more recently, by BPF tracing, as support was added in the Linux 4.17 kernel (with the perf_uprobe pmu)

There is also a register_uprobe_event() kernel function, similar to register_kprobe(), but it is not exposed as an API.

2.8.3 BPF and uprobes
uprobes provides user-level dynamic instrumentation for BCC and bpftrace, and is used by numerous tools. The interfaces are:

BCC: attach_uprobe() and attach_uretprobe()

bpftrace: uprobe and uretprobe probe types

The uprobes interface in BCC supports instrumenting the beginning of a function or an arbitrary address, whereas bpftrace currently supports instrumenting the beginning of a function only. The uretprobes interface for both tracers instruments the return of the function.

As an example from BCC, the gethostlatency(8) tool instruments host resolution calls (DNS) via the resolver library calls getaddrinfo(3), gethostbyname(3), and so on:

Click here to view code image


# gethostlatency
TIME      PID    COMM                  LATms HOST
01:42:15  19488  curl                  15.90 www.brendangregg.com
01:42:37  19476  curl                  17.40 www.netflix.com
01:42:40  19481  curl                  19.38 www.netflix.com
01:42:46  10111  DNS Res~er #659       28.70 www.google.com

The probes traced can be seen in the source to gethostlatency:

Click here to view code image


# grep attach_ gethostlatency.py
b.attach_uprobe(name="c", sym="getaddrinfo", fn_name="do_entry", pid=args.pid)
b.attach_uprobe(name="c", sym="gethostbyname", fn_name="do_entry",
b.attach_uprobe(name="c", sym="gethostbyname2", fn_name="do_entry",
b.attach_uretprobe(name="c", sym="getaddrinfo", fn_name="do_return",
b.attach_uretprobe(name="c", sym="gethostbyname", fn_name="do_return",
b.attach_uretprobe(name="c", sym="gethostbyname2", fn_name="do_return",

These are attach_uprobe() and attach_uretprobe() calls. The user-level functions can be seen after the “sym=” assignment.

As an example from bpftrace, these one-liners list and then count the invocations of all the gethost functions from the libc system library:

Click here to view code image


# bpftrace -l 'uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethost*'
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostname
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostid
[...]
# bpftrace -e 'uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethost* { @[probe] =
count(); }'
Attaching 10 probes...
^C

@[uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostname]: 2

This output shows that the gethostname() function was called twice during tracing.

2.8.4 uprobes Overhead and Future Work
uprobes can attach to events that fire millions of times per second, such as the user-level allocation routines: malloc() and free(). Even though BPF is performance optimized, multiplying a tiny amount of overhead by millions of times per second adds up. In some cases, malloc() and free() tracing, which should be go-to use cases for BPF, can slow the target application tenfold (10x) or more. This prohibits its use in these cases; such slowdowns are acceptable only when troubleshooting in a test environment, or in an already-broken production environment. Chapter 18 includes a section on the frequency of operations to help you work around this limitation. You need to be aware of which events are frequent to avoid tracing them if possible, and to look for slower events that you can trace instead to solve the same issue.

There may be a large improvement for user-space tracing in the future—perhaps even by the time you read this. Instead of continuing to use the current uprobes approach, which traps into the kernel, a shared-library solution is being discussed, which would provide BPF tracing of user space without the kernel mode switch. This approach has been in use by LTTng-UST for years, with performance measured at 10x to 100x faster [45].

2.8.5 uprobes Additional Reading
For more information, see Documentation/trace/uprobetracer.txt in the Linux kernel source [46].

2.9 TRACEPOINTS
Tracepoints are used for kernel static instrumentation. They involve tracing calls that developers have inserted into the kernel code at logical places; those calls are then compiled into the kernel binary. Developed by Mathieu Desnoyers in 2007, tracepoints were originally called Kernel Markers, and they were made available in the Linux 2.6.32 release in 2009. Table 2-7 compares kprobes and tracepoints.

Table 2-7 kprobes to Tracepoints Comparison

Detail

kprobes

Tracepoints

Type

Dynamic

Static

Rough number of events

50,000+

100+

Kernel maintenance

None

Required

Disabled overhead

None

Tiny (NOPs and metadata)

Stable API

No

Yes

Tracepoints are a burden for kernel developers to maintain, and tracepoints are far more limited in scope than kprobes. The advantage is that tracepoints provide a stable API24: Tools written to use tracepoints should continue working across newer kernel versions, whereas those written using kprobes may break if the traced function is renamed or changed.

24 I’d call it “best-effort stable.” It is rare, but I have seen tracepoints change.

You should always try to use tracepoints first, if available and sufficient, and turn to kprobes only as a backup.

The format of tracepoints is subsystem:eventname (for example, kmem:kmalloc) [47]. Tracers refer to the first component using different terms: as a system, subsystem, class, or provider.

2.9.1 Adding Tracepoint Instrumentation
As an example of a tracepoint, this section explains how sched:sched_process_exec is added to the kernel.

There are header files for tracepoints in include/trace/events. This is from sched.h:

Click here to view code image


#define TRACE_SYSTEM sched
[...]
/*
 * Tracepoint for exec:
 */
TRACE_EVENT(sched_process_exec,
        TP_PROTO(struct task_struct *p, pid_t old_pid,
                 struct linux_binprm *bprm),

        TP_ARGS(p, old_pid, bprm),

        TP_STRUCT__entry(
                __string(   filename,     bprm->filename)
                __field(      pid_t,        pid           )
                __field(      pid_t,        old_pid       )
        ),

        TP_fast_assign(
                __assign_str(filename, bprm->filename);
                __entry->pid         = p->pid;
                __entry->old_pid     = old_pid;
        ),

        TP_printk("filename=%s pid=%d old_pid=%d", __get_str(filename),
                  __entry->pid, __entry->old_pid)
);

This code defines the trace system as sched and the tracepoint name as sched_process_exec. The lines that follow define metadata, including a “format string” in TP_printk()—a helpful summary that is included when tracepoints are recorded with the perf(1) tool.

The previous information is also available at runtime via the Ftrace framework in /sys, via format files for each tracepoint. For example:

Click here to view code image


# cat /sys/kernel/debug/tracing/events/sched/sched_process_exec/format
name: sched_process_exec
ID: 298
format:
        field:unsigned short common_type;   offset:0;   size:2; signed:0;
        field:unsigned char common_flags;   offset:2;   size:1; signed:0;
        field:unsigned char common_preempt_count;   offset:3; size:1; signed:0;
        field:int common_pid;  offset:4;    size:4;     signed:1;

        field:__data_loc char[] filename;   offset:8;   size:4; signed:1;
        field:pid_t pid;       offset:12;   size:4;     signed:1;
        field:pid_t old_pid;   offset:16;   size:4;     signed:1;

print fmt: "filename=%s pid=%d old_pid=%d", __get_str(filename), REC->pid,
REC->old_pid

This format file is processed by tracers to understand the metadata associated with a tracepoint.

The following tracepoint is called from the kernel source in fs/exec.c, via trace_sched_process_exec():

Click here to view code image


static int exec_binprm(struct linux_binprm *bprm)
{
        pid_t old_pid, old_vpid;
        int ret;

        /* Need to fetch pid before load_binary changes it */
        old_pid = current->pid;
        rcu_read_lock();
        old_vpid = task_pid_nr_ns(current, task_active_pid_ns(current->parent));
        rcu_read_unlock();

        ret = search_binary_handler(bprm);
        if (ret >= 0) {
                audit_bprm(bprm);
                trace_sched_process_exec(current, old_pid, bprm);
                ptrace_event(PTRACE_EVENT_EXEC, old_vpid);
                proc_exec_connector(current);
        }
[...]

The trace_sched_process_exec() function marks the location of the tracepoint.

2.9.2 How Tracepoints Work
It is important that the not-enabled overhead of tracepoints be as tiny as possible, to avoid paying a performance tax for something that is not in use. Mathieu Desnoyers accomplished this by using a technique called “static jump patching.”25 It works like this, provided that a necessary compiler feature is available (asm goto):

25 Earlier versions used load immediate instructions, where the operand could be patched between 0 and 1 to control flow to a tracepoint [Desnoyers 09a][Desnoyers 09b]; however, this was not upstreamed, in favor of jump patching.

At kernel compile time, an instruction is added at the tracepoint location that does nothing. The actual instruction used depends on the architecture: For x86_64, it is a 5-byte no-operation (nop) instruction. This size is used so that it can be later replaced with a 5-byte jump (jmp) instruction.

A tracepoint handler (trampoline) is also added to the end of the function, which iterates over an array of registered tracepoint probe callbacks. This increases the instruction text size a little (as a trampoline, it is a small routine, so execution jumps in and then immediately bounces out), which may have a small impact on the instruction cache.

At runtime, when a tracer enables the tracepoint (it may already be in use by other running tracers):

The array of tracepoint callbacks is modified to add a new callback for the tracer, synchronized through RCU.

If the tracepoint was previously disabled, the nop location is rewritten to a jump to the tracepoint trampoline.

When a tracer disables the tracepoint:

The array of tracepoint callbacks is modified to remove the callback, synchronized through RCU.

If the last callback is removed, the static jump is rewritten back to a nop.

This minimizes the overhead of the not-enabled tracepoint such that it should be negligible.

If asm goto is not available, a fallback technique is used: Instead of patching a nop with a jmp, a conditional branch is used, based on a variable read from memory.

2.9.3 Tracepoint Interfaces
There are two interfaces for tracepoints:

Ftrace-based, via /sys/kernel/debug/tracing/events: which has subdirectories for each tracepoint system, and files for each tracepoint itself (tracepoints can be enabled and disabled by writing to these files.)

perf_event_open(): as used by the perf(1) tool and, more recently, by BPF tracing (via the perf_tracepoint pmu).

2.9.4 Tracepoints and BPF
Tracepoints provide kernel static instrumentation for BCC and bpftrace. The interfaces are:

BCC: TRACEPOINT_PROBE()

bpftrace: The tracepoint probe type

BPF supported tracepoints in Linux 4.7, but I developed many BCC tools prior to that support and had to use kprobes instead. This means that there are fewer tracepoint examples in BCC than I would like, due simply to the order in which support was developed.

An interesting example of BCC and tracepoints is the tcplife(8) tool. It prints one-line summaries of TCP sessions with various details (and is covered in more detail in Chapter 10):

Click here to view code image


# tcplife
PID   COMM       LADDR           LPORT RADDR           RPORT TX_KB RX_KB MS
22597 recordProg 127.0.0.1       46644 127.0.0.1       28527     0     0 0.23
3277  redis-serv 127.0.0.1       28527 127.0.0.1       46644     0     0 0.28
22598 curl       100.66.3.172    61620 52.205.89.26    80        0     1 91.79
22604 curl       100.66.3.172    44400 52.204.43.121   80        0     1 121.38
22624 recordProg 127.0.0.1       46648 127.0.0.1       28527     0     0 0.22
[...]

I wrote this tool before a suitable tracepoint existed in the Linux kernel, so I used a kprobe on the tcp_set_state() kernel function. A suitable tracepoint was added in Linux 4.16: sock:inet_sock_set_state. I modified the tool to support both so that it would run on both older and newer kernels. The tool defines two programs—one for tracepoints and one for kprobes—and then chooses which to run with the following test:

Click here to view code image


if (BPF.tracepoint_exists("sock", "inet_sock_set_state")):
    bpf_text += bpf_text_tracepoint
else:
    bpf_text += bpf_text_kprobe

As an example of bpftrace and tracepoints, the following one-liner instruments the sched:sched_process_exec tracepoint shown earlier:

Click here to view code image


# bpftrace -e 'tracepoint:sched:sched_process_exec { printf("exec by %s\n", comm); }'
Attaching 1 probe...
exec by ls
exec by date
exec by sleep
^C

This bpftrace one-liner prints out the process names that called exec().

2.9.5 BPF Raw Tracepoints
Alexei Starovoitov developed a new interface for tracepoints called BPF_RAW_TRACEPOINT, which was added to Linux 4.17 in 2018. It avoids the cost of creating the stable tracepoint arguments, which may not be needed, and exposes the raw arguments to the tracepoint. In a way, this is like accessing tracepoints as though they were kprobes: You end up with an unstable API, but you get access to more fields, and don’t pay the usual tracepoint performance taxes. It is also a little more stable than using kprobes, since the tracepoint probe names are stable, and only the arguments are not.

Alexei showed that the performance with BPF_RAW_TRACEPOINT was better than with both kprobes and standard tracepoints, with results from a stress test [48]:

Click here to view code image


samples/bpf/test_overhead performance on 1 cpu:

tracepoint    base  kprobe+bpf tracepoint+bpf raw_tracepoint+bpf
task_rename   1.1M   769K        947K            1.0M
urandom_read  789K   697K        750K            755K

This may be especially interesting for technologies that instrument tracepoints 24x7, to minimize the overhead of enabled tracepoints.

2.9.6 Additional Reading
For more information, see Documentation/trace/tracepoints.rst in the kernel source, by Mathieu Desnoyers [47].

2.10 USDT
User-level statically defined tracing (USDT) provides a user-space version of tracepoints. USDT has been implemented for BCC by Sasha Goldshtein, and for bpftrace by myself and Matheus Marchini.

There are numerous tracing or logging technologies for user-level software, and many applications come with their own custom event loggers that can be enabled when needed. What makes USDT different is that it relies on an external system tracer to activate. The USDT points in an application can’t be used, and they do nothing, without an external tracer.

USDT was made popular by the DTrace utility from Sun Microsystems, and it is now available in many applications.26 Linux has developed a way to make use of USDT, which came from the SystemTap tracer. The BCC and bpftrace tracing tools make use of this work, and both can instrument USDT events.

26 In some small part, this occurred through my own efforts: I promoted USDT, added USDT probes to Firefox for JavaScript inspection and other applications, and supported development efforts for other USDT providers.

One leftover from DTrace is still evident: Many applications do not compile USDT probes by default but require a configuration option such as --enable-dtrace-probes or --with-dtrace.

2.10.1 Adding USDT Instrumentation
USDT probes can be added to an application either using the headers and tools from the systemtap-sdt-dev package, or with custom headers. These probes define macros that can be placed at logical locations in your code to create USDT instrumentation points. The BCC project contains a USDT code example under examples/usdt_sample, which can be compiled using systemtap-sdt-dev headers or headers from Facebook’s Folly27 C++ library [11]. In the next section, I step through an example of using Folly.

27 Folly is a loose acronym of Facebook Open Source Library.

Folly
The steps to add USDT instrumentation using Folly are:

Add the header file to the target source code:

Click here to view code image

#include "folly/tracing/StaticTracepoint.h"
Add USDT probes to the target locations, of the format:

Click here to view code image

FOLLY_SDT(provider, name, arg1, arg2, ...)
The “provider” groups the probes, the “name” is the name of the probe, and then optional arguments are listed. The BCC USDT example contains:

Click here to view code image

FOLLY_SDT(usdt_sample_lib1, operation_start, operationId,
request.input().c_str());
This defines the probe as usdt_sample_lib1:operation_start, with the two arguments provided. The USDT example also contains an operation_end probe.

Build the software. You can check that the USDT probe exists by using readelf(1):

Click here to view code image


$ readelf -n usdt_sample_lib1/libusdt_sample_lib1.so
[...]
Displaying notes found in: .note.stapsdt
  Owner                 Data size  Description
  stapsdt              0x00000047  NT_STAPSDT (SystemTap probe descriptors)
    Provider: usdt_sample_lib1
    Name: operation_end
    Location: 0x000000000000fdd2, Base: 0x0000000000000000, Semaphore:
0x0000000000000000
    Arguments: -8@%rbx -8@%rax
  stapsdt              0x0000004f  NT_STAPSDT (SystemTap probe descriptors)
    Provider: usdt_sample_lib1
    Name: operation_start
    Location: 0x000000000000febe, Base: 0x0000000000000000, Semaphore:
0x0000000000000000
    Arguments: -8@-104(%rbp) -8@%rax

The -n option to readelf(1) prints the notes section, which should show information about the compiled USDT probes.

Optional: Sometimes the arguments you’d like to add to a probe are not readily available at the probe location, and must be constructed using CPU-expensive function calls. To avoid making these calls all the time when the probe is not in use, you can add a probe semaphore to the source file outside of the function:

Click here to view code image

FOLLY_SDT_DEFINE_SEMAPHORE(provider, name)
Then the probe point can become:

Click here to view code image


if (FOLLY_SDT_IS_ENABLED(provider, name)) {
    ... expensive argument processing ...
    FOLLY_SDT_WITH_SEMAPHORE(provider, name, arg1, arg2, ...);
}

Now the expensive argument processing occurs only when the probe is in use (enabled). The semaphore address will be visible in readelf(1), and tracing tools can set it when the probe is used.

This does complicate tracing tools a little: When semaphore-protected probes are in use, these tracing tools typically need to have a PID specified so that they set the semaphore for that PID.

2.10.2 How USDT Works
When applications are compiled, a no-operation (nop) instruction is placed at the address of the USDT probe. This address is then dynamically changed by the kernel to a breakpoint when instrumented, using uprobes.

As with uprobes, I can illustrate USDT in action, although it’s a little more work. The location of the probe from the previous readelf(1) output was 0x6a2. This is the offset from the binary segment, so you must first learn where that begins. This can vary thanks to position independent executables (PIE), which make more effective use of address space layout randomization (ASLR):

Click here to view code image


# gdb -p 4777
[...]
(gdb) info proc mappings
process 4777
Mapped address spaces:

        Start Addr         End Addr     Size   Offset objfile
    0x55a75372a000   0x55a75372b000   0x1000      0x0 /home/bgregg/Lang/c/tick
    0x55a75392a000   0x55a75392b000   0x1000      0x0 /home/bgregg/Lang/c/tick
    0x55a75392b000   0x55a75392c000   0x1000   0x1000 /home/bgregg/Lang/c/tick
[...]

The start address is 0x55a75372a000. Printing out the instruction at that address plus the offset of the probe, 0x6a2:

Click here to view code image


(gdb) disas 0x55a75372a000 + 0x6a2
[...]
   0x000055a75372a695 <+11>: mov    %rsi,-0x20(%rbp)
   0x000055a75372a699 <+15>: movl   $0x0,-0x4(%rbp)
   0x000055a75372a6a0 <+22>: jmp    0x55a75372a6c7 <main+61>
   0x000055a75372a6a2 <+24>: nop
   0x000055a75372a6a3 <+25>: mov    -0x4(%rbp),%eax
   0x000055a75372a6a6 <+28>: mov    %eax,%esi
   0x000055a75372a6a8 <+30>: lea    0xb5(%rip),%rdi        # 0x55a75372a764
[...]

And now with the USDT probe enabled:

Click here to view code image


(gdb) disas 0x55a75372a000 + 0x6a2
[...]
   0x000055a75372a695 <+11>: mov    %rsi,-0x20(%rbp)
   0x000055a75372a699 <+15>: movl   $0x0,-0x4(%rbp)
   0x000055a75372a6a0 <+22>: jmp    0x55a75372a6c7 <main+61>
   0x000055a75372a6a2 <+24>: int3
   0x000055a75372a6a3 <+25>: mov    -0x4(%rbp),%eax
   0x000055a75372a6a6 <+28>: mov    %eax,%esi
   0x000055a75372a6a8 <+30>: lea    0xb5(%rip),%rdi        # 0x55a75372a764
[...]

The nop instruction has changed to int3 (x86_64 breakpoint). When this breakpoint is hit, the kernel executes the attached BPF program with the arguments for the USDT probe. The nop instruction is restored when the USDT probe is deactivated.

2.10.3 BPF and USDT
USDT provides user-level static instrumentation for BCC and bpftrace. The interfaces are:

BCC: USDT().enable_probe()

bpftrace: The usdt probe type

For example, instrumenting the loop probe from the previous example:

Click here to view code image


# bpftrace -e 'usdt:/tmp/tick:loop { printf("got: %d\n", arg0); }'
Attaching 1 probe...
got: 0
got: 1
got: 2
got: 3
got: 4
^C

This bpftrace one-liner also printed out the integer argument passed to the probe.

2.10.4 USDT Additional Reading
More sources for understanding USDT:

“Hacking Linux USDT with Ftrace” by Brendan Gregg [49]

“USDT Probe Support in BPF/BCC” by Sasha Goldshtein [50]

“USDT Tracing Report” by Dale Hamel [51]

2.11 DYNAMIC USDT
The USDT probes described previously are added to source code and compiled into the resulting binary, leaving nops at the instrumentation points and metadata in the ELF notes section. However, some languages, such as Java with the JVM, are interpreted or compiled on the fly. Dynamic USDT can be used to add instrumentation points in the Java code.

Note that the JVM already contains many USDT probes in its C++ code—for GC events, class loading, and other high-level activities. These USDT probes are instrumenting the function of the JVM. But USDT probes cannot be added to Java code that is compiled on the fly. USDT expects a pre-compiled ELF file with a notes section containing probe descriptions, and that doesn’t exist for JIT-compiled Java code.

Dynamic USDT solves this by:

Pre-compiling a shared library with the desired USDT probes embedded in functions. This shared library can be in C or C++, and it has an ELF notes section for the USDT probes. It can be instrumented like any other USDT probe.

Loading the shared library when required with dlopen(3).

Adding shared library calls from the target language. These can be implemented with an API that suits the language, hiding the underlying shared library call.

This has been implemented for Node.js and Python by Matheus Marchini in a library called libstapsdt,28 which provides a way to define and call USDT probes in those languages. Support for other languages can usually be added by wrapping this library, as has been done by Dale Hamel for Ruby, using Ruby’s C-extension support [54].

28 For libstapsdt, see [52][53]. A new library called libusdt is being written for this purpose, and it might change the following code example. Check for future releases of libusdt.

For example, in Node.js JavaScript:

Click here to view code image


const USDT = require("usdt");
const provider = new USDT.USDTProvider("nodeProvider");
const probe1 = provider.addProbe("requestStart","char *");
provider.enable();

[...]
probe1.fire(function() { return [currentRequestString]; });
[...]

The probe1.fire() call executes its anonymous function only if the probe was instrumented externally. Within this function, arguments can be processed (if necessary) before being passed to the probe, without concern about the non-enabled CPU cost of such argument processing since it is skipped if the probe was not in use.

libstapsdt automatically creates a shared library containing the USDT probes and ELF notes section at runtime, and it maps that section into the running program’s address space.

2.12 PMCS
Performance monitoring counters (PMCs) are also known by other names, such as performance instrumentation counters (PICs), CPU performance counters (CPCs), and performance monitoring unit events (PMU events). These terms all refer to the same thing: programmable hardware counters on the processor.

While there are many PMCs, Intel has selected seven PMCs as an “architectural set” that provides a high-level overview of some core functions [Intel 16]. The presence of these architectural set PMCs can be checked using the CPUID instruction. Table 2-8 shows this set, which serves as an example of useful PMCs.

Table 2-8 Intel Architectural PMCs

Event Name

UMask

Event Select

Example Event Mask Mnemonic

UnHalted Core Cycles

00H

3CH

CPU_CLK_UNHALTED.THREAD_P

Instruction Retired

00H

C0H

INST_RETIRED.ANY_P

UnHalted Reference Cycles

01H

3CH

CPU_CLK_THREAD_UNHALTED.REF_XCLK

LLC References

4FH

2EH

LONGEST_LAT_CACHE.REFERENCE

LLC Misses

41H

2EH

LONGEST_LAT_CACHE.MISS

Branch Instruction Retired

00H

C4H

BR_INST_RETIRED.ALL_BRANCHES

Branch Misses Retired

00H

C5H

BR_MISP_RETIRED.ALL_BRANCHES

PMCs are a vital resource for performance analysis. Only through PMCs can you measure the efficiency of CPU instructions; the hit ratios of CPU caches; memory, interconnect, and device bus utilization; stall cycles; and so on. Using these measurements to analyze performance can lead to various small performance optimizations.

PMCs are also a strange resource. While there are hundreds of PMCs available, only a fixed number of registers (perhaps as few as six) are available in the CPUs to measure them at the same time. You need to choose which PMCs you’d like to measure on those six registers, or cycle through different PMC sets as a way of sampling them. (Linux perf(1) supports this cycling automatically.) Other software counters do not suffer from these constraints.

2.12.1 PMC Modes
PMCs can be used in one of two modes:

Counting: In this mode, PMCs keep track of the rate of events. The kernel can read the count whenever desired, such as for fetching per-second metrics. The overhead of this mode is practically zero.

Overflow Sampling: In this mode, the PMCs can send interrupts to the kernel for the events they are monitoring, so that the kernel can collect extra state. The events monitored can occur millions or billions of times per second; sending an interrupt for each one would grind the system to a near halt. The solution is to take a sample of events by using a programmable counter that signals the kernel when the counter overflows (e.g., once every 10,000 LLC cache miss or once every 1 million stall cycles).

The sampling mode is most interesting for BPF tracing since it generates events that you can instrument with custom BPF programs. Both BCC and bpftrace support PMC events.

2.12.2 PEBS
Overflow sampling may not record the correct instruction pointer that triggered an event due to interrupt latency (often called “skid”) or out-of-order instruction execution. For CPU cycle profiling, such skid may not be a problem, and some profilers deliberately introduce jitter to avoid lockstep sampling (or use an offset sampling rate, such as 99 Hertz). But for measuring other events, such as LLC misses, the sampled instruction pointer needs to be accurate.

Intel has developed a solution called precise event-based sampling (PEBS). PEBS uses hardware buffers to record the correct instruction pointer at the time of the PMC event. The Linux perf_events framework supports using PEBS.

2.12.3 Cloud Computing
Many cloud computing environments have not yet provided PMC access to their guests. It is technically possible to enable it; for example, the Xen hypervisor has the vpmu command line option, which allows different sets of PMCs to be exposed to guests [55].29 Amazon has enabled many PMCs for its Nitro hypervisor guests.

29 I wrote the Xen code that allows different PMC modes: ipc for instructions-per-cycle PMCs only, and arch for the Intel architectural set. My code was just a firewall on the existing vpmu support in Xen.

2.13 PERF_EVENTS
The perf_events facility is used by the perf(1) command for sampling and tracing, and it was added to Linux 2.6.21 in 2009. Importantly, perf(1) and its perf_events facility have received a lot of attention and development over the years, and BPF tracers can make calls to perf_events to use its features. BCC and bpftrace first used perf_events for its ring buffer, and then for PMC instrumentation, and now for all event instrumentation via perf_event_open().

While BPF tracing tools make use of perf(1)’s internals, an interface for BPF has been developed and added to perf(1) as well, making perf(1) another BPF tracer. Unlike with BCC and bpftrace, the source code to perf(1) is in the Linux tree, so perf(1) is the only BPF front-end tracer that is built into Linux.

perf(1) BPF is still under development and is difficult to use. Covering it is beyond the scope of these chapters, which focus on BCC and bpftrace tools. An example of perf BPF is included in Appendix D.

2.14 SUMMARY
BPF performance tools make use of many technologies, including extended BPF, kernel and user dynamic instrumentation (kprobes and uprobes), kernel and user static tracing (tracepoints and user markers), and perf_events. BPF can also fetch stack traces by using frame pointer–based walks or ORC for kernel stacks, and these can be visualized as flame graphs. These technologies are covered in this chapter, including references for further reading.