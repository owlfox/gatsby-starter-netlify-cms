Chapter 10. Networking
Networking is playing an ever-increasing role in the performance analysis of systems, with the rise of distributed cloud computing models increasing network traffic within a datacenter or cloud environment, and online applications increasing external network traffic. The need for efficient network analysis tools is also on the rise, as servers scale to processing millions of packets per second. Extended BPF began as a technology for packet processing, so it has been designed and built to operate at these rates. The Cilium project for container networking and security policies, and Facebook’s Katran scalable network load balancer, are further examples of BPF’s ability to handle high packet rates in production environments, including for distributed denial of service attack (DDoS) mitigation.1

1 Both of these are also open source [93] [94].

Network I/O is processed by many different layers and protocols, including the application, protocol libraries, syscalls, TCP or UDP, IP, and device drivers for the network interface. These can all be traced with the BPF tools shown in this chapter, providing insight on the requested workloads and latencies encountered.

Learning Objectives:

Gain a high-level view of the networking stack and scalability approaches, including receive and transmit scaling, TCP buffers, and queueing disciplines

Learn a strategy for successful analysis of network performance

Characterize socket, TCP, and UDP workloads to identify issues

Measure different latency metrics: connection latency, first byte latency, connection duration

Learn an efficient way to trace and analyze TCP retransmits

Investigate inter-network-stack latency

Quantify time spent in software and hardware networking queues

Use bpftrace one-liners to explore networking in custom ways

This chapter begins with the necessary background for networking analysis, summarizing the network stack and scalability approaches. I explore questions that BPF can answer, and provide an overall strategy to follow. I then focus on tools, starting with traditional tools and then BPF tools, including a list of BPF one-liners. This chapter ends with optional exercises.

10.1 BACKGROUND
This section covers networking fundamentals, BPF capabilities, a suggested strategy for networking analysis, and common tracing mistakes.

10.1.1 Networking Fundamentals
A basic knowledge of IP and TCP, including the TCP three-way handshake, acknowledgment packets, and active/passive connection terminology, is assumed for this chapter.

Network Stack
The Linux network stack is pictured in Figure 10-1, which shows how data commonly moves from an application to a network interface card (NIC).


Figure 10-1 Linux network stack

Major components include:

Sockets: Endpoints for sending or receiving data. These also include the send and receive buffers used by TCP.

TCP (Transmission Control Protocol): A widely used transport protocol for transferring data in an ordered and reliable way, with error checking.

UDP (User Datagram Protocol): A simple transport protocol for sending messages without the overhead or guarantees of TCP.

IP (Internet Protocol): A network protocol for delivering packets between hosts on a network. Main versions are IPv4 and IPv6.

ICMP (Internet Control Message Protocol): An IP-level protocol to support IP, relaying messages about routes and errors.

Queueing discipline: An optional layer for traffic classification (tc), scheduling, manipulation, filtering, and shaping [95]2.

2 This reference is for “Queueing in the Linux Network Stack” by Dan Siemon, published by Linux Journal in 2013, an excellent explanation of these queues. Coincidentally, about 90 minutes after writing this section, I found myself on an iovisor concall with Dan Siemon and was able to thank him directly.

Device drivers: Drivers that may include their own driver queues (NIC RX-ring and TX-ring).

NIC (network interface card): A device that contains the physical network ports. These can also be virtual devices, such as tunnels, veths (virtual Ethernet devices), and loopback.

Figure 10-1 shows the path most commonly taken, but other paths may be used to improve the performance of certain workloads. These different paths include kernel bypass and the new BPF-based XDP.

Kernel Bypass
Applications can bypass the kernel network stack using technologies such as the Data Plane Development Kit (DPDK) for achieving higher packet rates and performance. This involves an application implementing its own network protocols in user-space, and making writes to the network driver via a DPDK library and a kernel user space I/O (UIO) or virtual function I/O (VFIO) driver. The expense of copying packet data can be avoided by directly accessing memory on the NIC.

Because the kernel network stack is bypassed, instrumentation using traditional tools and metrics is not available, making performance analysis more difficult.

XDP
The eXpress Data Path (XDP) technology provides another path for network packets: a programmable fast path that uses extended BPF, and which integrates into the existing kernel stack rather than bypassing it [Høiland-Jørgensen 18]. Because it accesses the raw network Ethernet frame as early as possible via a BPF hook inside the NIC driver, it can make early decisions about forwarding or dropping without the overhead of TCP/IP stack processing. When needed, it can also fall back to regular network stack processing. Use cases include faster DDoS mitigation, and software-defined routing.

Internals
An understanding of some kernel internals will help you understand later BPF tools. The essentials are: packets are passed through the kernel using an sk_buff struct (socket buffer). Sockets are defined by a sock struct embedded at the start of protocol variants such as tcp_sock. Network protocols are attached to sockets using a struct proto, such that there is a tcp_prot, udp_prot, etc; this struct defines callback functions for operating the protocol, including for connect, sendmsg, and recvmsg.

Receive and Transmit Scaling
Without a CPU load-balancing strategy for network packets, a NIC may only interrupt one CPU, which can drive it to 100% utilization in interrupt and network stack processing, becoming a bottleneck. Various policies are available for interrupt mitigation and distributing NIC interrupts and packet processing across multiple CPUs, improving scalability and performance. These include the new API (NAPI) interface, Receive Side Scaling (RSS),3 Receive Packet Steering (RPS), Receive Flow Steering (RFS), Accelerated RFS, and Transmit Packet Steering (XPS). These are documented in the Linux source [96].

3 RSS is processed purely by NIC hardware. Some NICs support offloading of BPF networking programs (e.g., Netronome), allowing RSS to become BPF programmable [97].

Socket Accept Scaling
A commonly used model to handle high rates of passive TCP connections uses a thread to process the accept(2) calls and then pass the connection to a pool of worker threads. To scale this further, a SO_REUSEPORT setsockopt(3) option was added in Linux 3.9 that allows a pool of processes or threads to bind to the same socket address, where they all can call accept(2). It is then up to the kernel to balance the new connections across the pool of bound threads. A BPF program can be supplied to steer this balancing via the SO_ATTACH_REUSEPORT_EBPF option: this was added for UDP in Linux 4.5, and TCP in Linux 4.6.

TCP Backlogs
Passive TCP connections are initiated by the kernel receiving a TCP SYN packet. The kernel must track state for this potential connection until the handshake is completed, a situation that in the past was abused by attackers using SYN floods to exhaust kernel memory. Linux uses two queues to prevent this: a SYN backlog with minimal metadata that can better survive SYN floods, and then a listen backlog for completed connections for the application to consume. This is pictured in Figure 10-2.

Packets can be dropped from the SYN backlog in the case of flooding, or the listen backlog if the application cannot accept connections quickly enough. A legitimate remote host will respond with a timer-based retransmit.

In addition to the two-queue model, the TCP listen path was also made lockless to improve scalability for SYN flood attacks [98].4

4 The developer, Eric Dumazet, was able to reach six million SYN packets per second on his system after fixing a final false-sharing issue [99].


Figure 10-2 TCP SYN backlogs

TCP Retransmits
TCP detects and retransmits lost packets using one of two techniques:

Timer-based retransmits: These occur when a time has passed and a packet acknowledgment has not yet been received. This time is the TCP retransmit timeout, calculated dynamically based on the connection round trip time (RTT). On Linux, this will be at least 200 ms (TCP_RTO_MIN) for the first retransmit, and subsequent retransmits will be much slower, following an exponential backoff algorithm that doubles the timeout.

Fast retransmits: When duplicate ACKs arrive, TCP can assume that a packet was dropped and retransmit it immediately.

Timer-based retransmits in particular cause performance issues, injecting latencies of 200 ms and higher into network connections. Congestion control algorithms may also throttle throughput in the presence of retransmits.

Retransmits can require a sequence of packets to be resent, beginning from the lost packet, even if later packets were received correctly. Selective acknowledgments (SACK) is a TCP option commonly used to avoid this: it allows later packets to be acknowledged so that they do not need to be resent, improving performance.

TCP Send and Receive Buffers
TCP data throughput is improved by using socket send and receive buffer accounting. Linux dynamically sizes the buffers based on connection activity, and allows tuning of their minimum, default, and maximum sizes. Larger sizes improve performance at the cost of more memory per connection. They are shown in Figure 10-3.


Figure 10-3 TCP send and receive buffers

Network devices and networks accept packet sizes up to a maximum segment size (MSS) that may be as small as 1500 bytes. To avoid the network stack overheads of sending many small packets, TCP uses generic segmentation offload (GSO) to send packets up to 64 Kbytes in size (“super packets”), which are split into MSS-sized segments just before delivery to the network device. If the NIC and driver support TCP segmentation offload (TSO), GSO leaves splitting to the device, further improving network stack throughput. There is also a generic receive offload (GRO) complement to GSO [100]. GRO and GSO are implemented in kernel software, and TSO is implemented by NIC hardware.

TCP Congestion Controls
Linux supports different TCP congestion control algorithms, including Cubic (the default), Reno, Tahoe, DCTCP, and BBR. These algorithms modify send and receive windows based on detected congestion to keep network connections running optimally.

Queueing Discipline
This optional layer manages traffic classification (tc), scheduling, manipulation, filtering, and shaping of network packets. Linux provides numerous queueing discipline algorithms, which can be configured using the tc(8) command. As each has a man page, the man(1) command can be used to list them:

Click here to view code image


# man -k tc-
tc-actions (8)       - independently defined actions in tc
tc-basic (8)         - basic traffic control filter
tc-bfifo (8)         - Packet limited First In, First Out queue
tc-bpf (8)           - BPF programmable classifier and actions for ingress/egress
queueing disciplines
tc-cbq (8)           - Class Based Queueing
tc-cbq-details (8)   - Class Based Queueing
tc-cbs (8)           - Credit Based Shaper (CBS) Qdisc
tc-cgroup (8)        - control group based traffic control filter
tc-choke (8)         - choose and keep scheduler
tc-codel (8)         - Controlled-Delay Active Queue Management algorithm
tc-connmark (8)      - netfilter connmark retriever action
tc-csum (8)          - checksum update action
tc-drr (8)           - deficit round robin scheduler
tc-ematch (8)        - extended matches for use with "basic" or "flow" filters
tc-flow (8)          - flow based traffic control filter
tc-flower (8)        - flow based traffic control filter
tc-fq (8)            - Fair Queue traffic policing
tc-fq_codel (8)      - Fair Queuing (FQ) with Controlled Delay (CoDel)
[...]

BPF can enhance the capabilities of this layer with the programs of type BPF_PROG_TYPE_SCHED_CLS and BPF_PROG_TYPE_SCHED_ACT.

Other Performance Optimizations
There are other algorithms in use throughout the network stack to improve performance, including:

Nagle: This reduces small network packets by delaying their transmission, allowing more to arrive and coalesce.

Byte Queue Limits (BQL): These automatically size the driver queues large enough to avoid starvation, but also small enough to reduce the maximum latency of queued packets. It works by pausing the addition of packets to the driver queue when necessary, and was added in Linux 3.3 [95].

Pacing: This controls when to send packets, spreading out transmissions (pacing) to avoid bursts that may hurt performance.

TCP Small Queues (TSQ): This controls (reduces) how much is queued by the network stack to avoid problems including bufferbloat [101].

Early Departure Time (EDT): This uses a timing wheel to order packets sent to the NIC, instead of a queue. Timestamps are set on every packet based on policy and rate configuration. This was added in Linux 4.20, and has BQL- and TSQ-like capabilities [Jacobson 18].

These algorithms often work in combination to improve performance. A TCP sent packet can be processed by any of the congestion controls, TSO, TSQ, Pacing, and queueing disciplines, before it ever arrives at the NIC [Cheng 16].

Latency Measurements
Various networking latency measurements can be made to provide insight into performance, helping to determine whether bottlenecks are in the sending or receiving applications, or the network itself. These include [Gregg 13b]:

Name resolution latency: The time for a host to be resolved to an IP address, usually by DNS resolution—a common source of performance issues.

Ping latency: The time from an ICMP echo request to a response. This measures the network and kernel stack handling of the packet on each host.

TCP connection latency: The time from when a SYN is sent to when the SYN,ACK is received. Since no applications are involved, this measures the network and kernel stack latency on each host, similar to ping latency, with some additional kernel processing for the TCP session. TCP Fast Open (TFO) is a technology to eliminate connection latency for subsequent connections by providing cryptographic cookie with the SYN to authenticate the client immediately, allowing the server to respond with data without waiting for the three-way handshake to complete.

TCP first byte latency: Also known as the time-to-first-byte latency (TTFB), this measures the time from when a connection is established to when the first data byte is received by the client. This includes CPU scheduling and application think time for the host, making it a more a measure of application performance and current load than TCP connection latency.

Round trip time (RTT): The time for a network packet to make a round trip between endpoints. The kernel may use such measurements with congestion control algorithms.

Connection lifespan: The duration of a network connection from initialization to close. Some protocols like HTTP can use a keep-alive strategy, leaving connections open and idle for future requests, to avoid the overheads and latency of repeated connection establishment.

Using these in combination can help locate the source of latency, by process of elimination. They should also be used in combination with other metrics to understand network health, including event rates and throughput.

Further Reading
This summarized selected topics as background for network analysis tools. The implementation of the Linux network stack is described in the kernel source under Documentation/networking [102], and network performance is covered in more depth in Chapter 10 of Systems Performance [Gregg 13a].

10.1.2 BPF Capabilities
Traditional network performance tools operate on kernel statistics and network packet captures. BPF tracing tools can provide more insight, answering:

What socket I/O is occurring, and why? What are the user-level stacks?

Which new TCP sessions are created, and by which processes?

Are there socket, TCP, or IP-level errors occurring?

What are the TCP window sizes? Any zero-size transmits?

What is the I/O size at different stack layers? To the devices?

Which packets are dropped by the network stack, and why?

What are the TCP connection latency, first byte latency, and lifespans?

What is the kernel inter-network-stack latency?

How long do packets spend on the qdisc queues? Network driver queues?

What higher-level protocols are in use?

These can be answered with BPF by instrumenting tracepoints when available, and then using kprobes and uprobes when details beyond tracepoint coverage are needed.

Event Sources
Table 10-1 lists networking targets and the sources that can instrument them.

Table 10-1 Network Events and Sources

Network Event

Event Source

Application protocols

uprobes

Sockets

syscalls tracepoints

TCP

tcp tracepoints, kprobes

UDP

kprobes

IP and ICMP

kprobes

Packets

skb tracepoints, kprobes

QDiscs and driver queues

qdisc and net tracepoints, kprobes

XDP

xdp tracepoints

Network device drivers

kprobes

In many cases, kprobes must be used due to a lack of tracepoints. One reason that there are so few tracepoints is the historical (pre-BPF) lack of demand. Now that BPF is driving demand, the first TCP tracepoints were added in the 4.15 and 4.16 kernels. By Linux 5.2, the TCP tracepoints are:

Click here to view code image


# bpftrace -l 'tracepoint:tcp:*'
tracepoint:tcp:tcp_retransmit_skb
tracepoint:tcp:tcp_send_reset
tracepoint:tcp:tcp_receive_reset
tracepoint:tcp:tcp_destroy_sock
tracepoint:tcp:tcp_rcv_space_adjust
tracepoint:tcp:tcp_retransmit_synack
tracepoint:tcp:tcp_probe

More network protocol tracepoints may be added in future kernels. It may seem obvious to add send and receive tracepoints for the different protocols, but that involves modifying critical latency-sensitive code paths, and care must be taken to understand the not-enabled overheads that such additions would introduce.

Overhead
Network events can be frequent, exceeding several million packets per second on some servers and workloads. Fortunately, BPF originated as an efficient per-packet filter, and adds only a tiny amount of overhead to each event. Nevertheless, when multiplied by millions or 10 millions of events per second, that can add up to become a noticeable or even significant overhead.

Fortunately, many observability needs can be met without per-packet tracing, by instead tracing events that have a much lower frequency and therefore lower overhead. TCP retransmits, for example, can be traced via the tcp_retransmit_skb() kernel function alone, without needing to trace each packet. I did this for a recent production issue, where the server packet rate was over 100,000/second, and the retransmit rate was 1000/second. Whatever the overhead was for packet tracing, my choice of event to trace reduced it one hundred fold.

For times when it is necessary to trace each packet, raw tracepoints (introduced in Chapter 2) are a more efficient option than tracepoints and kprobes.

A common technique for network performance analysis involves collecting per-packet captures (tcpdump(8), libpcap, etc.), which not only adds overhead to each packet but also additional CPU, memory, and storage overheads when writing these packets to the file system, then additional overheads when reading them again for post-processing. In comparison, BPF per-packet tracing is already a large efficiency improvement. Because it emits summaries calculated in kernel memory only, without the use of capture files.

10.1.3 Strategy
If you are new to network performance analysis, here is a suggested overall strategy you can follow. The next sections explain these tools in more detail.

This strategy begins by using workload characterization to spot inefficiencies (steps 1 and 2), then checks interface limits (step 3) and different sources of latency (steps 4, 5, and 6). At this point, it may be worth trying experimental analysis (step 7)—bearing in mind, however, that it can interfere with production workloads—followed by more advanced and custom analysis (steps 8, 9, and 10).

Use counter-based tools to understand basic network statistics: packet rates and throughput and, if TCP is in use, TCP connection rates and TCP retransmit rates (e.g., using ss(8), nstat(8), netstat(1) and sar(1)).

Trace which new TCP connections are created, and their duration, to characterize the workload and look for inefficiencies (e.g., using BCC tcplife(8)). For example, you might find frequent connections to read a resource from a remote service that can be cached locally.

Check whether network interface throughput limits have been hit (e.g., using sar(1) or nicstat(1)’s interface utilization percent).

Trace TCP retransmits and other unusual TCP events (e.g., BCC tcpretrans(8), tcpdrop(8), and the skb:kfree_skb tracepoint).

Measure host name resolution (DNS) latency, as this is a common source of performance issues (e.g., BCC gethostlatency(8)).

Measure networking latency from different points: connection latency, first byte latency, inter-stack latency, etc.

Note that network latency measurements can vary significantly with load due to bufferbloat in the network (an issue of excessive queueing latency). If possible, it can be useful to measure these latencies during load, and also for an idle network, for comparison.

Use load-generation tools to explore network throughput limits between hosts, and to examine network events against a known workload (e.g., using iperf(1) and netperf(1)).

Browse and execute the BPF tools listed in the BPF tools section of this book.

Use high-frequency CPU profiling of kernel stack traces to quantify CPU time spent in protocol and driver processing.

Use tracepoints and kprobes to explore network stack internals.

10.1.4 Common Tracing Mistakes
Some common mistakes when developing BPF tools for network analysis:

Events may not happen in application context. Packets may be received when the idle thread is on-CPU, and TCP sessions may be initialized and change state at this time. Examining the on-CPU PID and process name for these events will not show the application endpoint for the connection. You need to choose different events that are in application context, or cache application context by an identifier (e.g., struct sock) that can be fetched later.

There may be fast paths and slow paths. You may write a program that seems to work, but is only tracing one of these paths. Use known workloads and ensure that packet and byte counts match.

In TCP there are full sockets and non-full sockets: the latter are request sockets before the three-way handshake has completed, or when the socket is in the TCP TIME_WAIT state. Some socket struct fields may not be valid for non-full sockets.

10.2 TRADITIONAL TOOLS
Traditional performance tools can display kernel statistics for packet rates, various events, and throughput and show the state of open sockets. Many such statistics are commonly collected and graphed by monitoring tools. Another type of tool captures packets for analysis, allowing each packet header and contents to be studied.

Apart from solving issues, traditional tools can also provide clues to direct your further use of BPF tools. They have been categorized in Table 10.2 based on their source and measurement type, kernel statistics or packet captures.

Table 10-2 Traditional Tools

Tool

Type

Description

ss

Kernel statistics

Socket statistics

ip

Kernel statistics

IP statistics

nstat

Kernel statistics

Network stack statistics

netstat

Kernel statistics

Multi-tool for showing network stack statistics and state

sar

Kernel statistics

Multi-tool for showing networking and other statistics

nicstat

Kernel statistics

Network interface statistics

ethtool

Driver statistics

Network interface driver statistics

tcpdump

Packet capture

Capture packets for analysis

The following sections summarize key functionality of these observability tools. Refer to their man pages and other resources, including Systems Performance [Gregg 13a], for more usage and explanations.

Note that there are also tools that perform experiments for network analysis. These include micro benchmarks such as iperf(1) and netperf(1), ICMP tools including ping(1), and network route discovery tools including traceroute(1) and pathchar. There is also the Flent GUI for automating network tests [103]. And there are tools for static analysis: checking the configuration of the system and hardware, without necessarily having any workload applied [Elling 00]. These experimental and static tools are covered elsewhere (e.g., [Gregg 13a]).

The ss(8), ip(8), and nstat(8) tools are covered first, as these are from the iproute2 package that is maintained by the network kernel engineers. Tools from this package are most likely to support the latest Linux kernel features.

10.2.1 ss
ss(8) is a socket statistics tool that summarizes open sockets. The default output provides high-level information about sockets, for example:

Click here to view code image


# ss
Netid State     Recv-Q  Send-Q    Local Address:Port      Peer Address:Port
[...]
tcp   ESTAB     0       0         100.85.142.69:65264    100.82.166.11:6001
tcp   ESTAB     0       0         100.85.142.69:6028     100.82.16.200:6101
[...]

This output is a snapshot of the current state. The first column shows the protocol used by the sockets: these are TCP. Since this output lists all established connections with IP address information, it can be used to characterize the current workload, and answer questions including how many client connections are open, how many concurrent connections there are to a dependency service, etc.

Much more information is available using options. For example, showing TCP sockets only (-t), with TCP internal info (-i), extended socket info (-e), process info (-p), and memory usage (-m):

Click here to view code image


# ss -tiepm
State     Recv-Q  Send-Q    Local Address:Port      Peer Address:Port

ESTAB     0        0       100.85.142.69:65264    100.82.166.11:6001
 users:(("java",pid=4195,fd=10865)) uid:33 ino:2009918 sk:78 <->
         skmem:(r0,rb12582912,t0,tb12582912,f266240,w0,o0,bl0,d0) ts sack bbr ws
cale:9,9 rto:204 rtt:0.159/0.009 ato:40 mss:1448 pmtu:1500 rcvmss:1448 advmss:14
48 cwnd:152 bytes_acked:347681 bytes_received:1798733 segs_out:582 segs_in:1397
data_segs_out:294 data_segs_in:1318 bbr:(bw:328.6Mbps,mrtt:0.149,pacing_gain:2.8
8672,cwnd_gain:2.88672) send 11074.0Mbps lastsnd:1696 lastrcv:1660 lastack:1660
pacing_rate 2422.4Mbps delivery_rate 328.6Mbps app_limited busy:16ms rcv_rtt:39.
822 rcv_space:84867 rcv_ssthresh:3609062 minrtt:0.139
[...]

This output includes many details. Highlighted in bold are the endpoint addresses and the following details:

"java",pid=4195: Process name "java", PID 4195

fd=10865: File descriptor 10865 (for PID 4195)

rto:204: TCP retransmission timeout: 204 milliseconds

rtt:0.159/0.009: Average round-trip time is 0.159 milliseconds, with 0.009 milliseconds mean deviation

mss:1448: Maximum segment size: 1448 bytes

cwnd:152: Congestion window size: 152 × MSS

bytes_acked:347681: 340 Kbytes successfully transmitted

bytes_received:1798733: 1.72 Mbytes received

bbr:...: BBR congestion control statistics

pacing_rate 2422.4Mbps: Pacing rate of 2422.4 Mbps

This tool uses the netlink interface, which uses sockets of family AF_NETLINK to fetch information from the kernel.

10.2.2 ip
ip(8) is a tool for managing routing, network devices, interfaces, and tunnels. For observability, it can be used to print statistics on various objects: link, address, route, etc. For example, printing extra statistics (-s) on interfaces (link):

Click here to view code image


# ip -s link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT
group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    RX: bytes  packets  errors  dropped overrun mcast
    26550075   273178   0       0       0       0
    TX: bytes  packets  errors  dropped carrier collsns
    26550075   273178   0       0       0       0
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT
group default qlen 1000
    link/ether 12:c0:0a:b0:21:b8 brd ff:ff:ff:ff:ff:ff
    RX: bytes  packets  errors  dropped overrun mcast
    512473039143 568704184 0       0       0       0
    TX: bytes  packets  errors  dropped carrier collsns
    573510263433 668110321 0       0       0       0

Various error types can be checked from this output: for receive (RX): receive errors, drops, and overruns; for transmit (TX): transmit errors, drops, carrier errors, and collisions. Such errors can be a source of performance issues and, depending on the error, may be caused by faulty network hardware.

Printing the route object shows the routing table:

Click here to view code image


# ip route
default via 100.85.128.1 dev eth0
default via 100.85.128.1 dev eth0 proto dhcp src 100.85.142.69 metric 100
100.85.128.0/18 dev eth0 proto kernel scope link src 100.85.142.69
100.85.128.1 dev eth0 proto dhcp scope link src 100.85.142.69 metric 100

Misconfigured routes can also be a source of performance problems.

10.2.3 nstat
nstat(8) prints the various network metrics maintained by the kernel, with their SNMP names:

Click here to view code image


# nstat -s
#kernel
IpInReceives                    462657733          0.0
IpInDelivers                    462657733          0.0
IpOutRequests                   497050986          0.0
[...]
TcpActiveOpens                  362997             0.0
TcpPassiveOpens                 9663983            0.0
TcpAttemptFails                 12718              0.0
TcpEstabResets                  14591              0.0
TcpInSegs                       462181482          0.0
TcpOutSegs                      938958577          0.0
TcpRetransSegs                  129212             0.0
TcpOutRsts                      52362              0.0
[...]

The -s option was used to avoid resetting these counters, which is the default behavior of nstat(8). Resetting is useful, as you can then run nstat(8) a second time and see counts that spanned that interval, rather than totals since boot. If you had a network problem that could be reproduced with a command, then nstat(8) can be run before and after the command to show which counters changed.

nstat(8) also has a daemon mode (-d) to collect interval statistics, which when used are shown in the last column.

10.2.4 netstat
netstat(8) is a tool traditionally used for reporting different types of network statistics based on the options used. These options include:

(default): Lists open sockets

-a: Lists information for all sockets

-s: Network stack statistics

-i: Network interface statistics

-r: Lists the route table

For example, modifying the default output with -a to show all sockets, and -n to not resolve IP addresses (otherwise, this invocation can cause a heavy name resolution workload as a side effect), and -p to show process information:

Click here to view code image


# netstat -anp
Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address     Foreign Address      State       PID/Program name
tcp        0      0 192.168.122.1:53  0.0.0.0:*            LISTEN      8086/dnsmasq
tcp        0      0 127.0.0.53:53     0.0.0.0:*            LISTEN      1112/systemd-resolv
tcp        0      0 0.0.0.0:22        0.0.0.0:*            LISTEN      1440/sshd
[...]
tcp        0      0 10.1.64.90:36426  10.2.25.52:22        ESTABLISHED 24152/ssh
[...]

The -i option prints interface statistics. On a production cloud instance:

Click here to view code image


# netstat -i
Kernel Interface table
Iface   MTU     RX-OK RX-ERR RX-DRP RX-OVR     TX-OK TX-ERR TX-DRP TX-OVR Flg
eth0   1500 743442015      0      0 0      882573158      0      0      0 BMRU
lo    65536    427560      0      0 0         427560      0      0      0 LRU

The interface eth0 is the primary interface. The fields show receive (RX-) and transmit (TX-):

OK: Packets transferred successfully

ERR: Packet errors

DRP: Packet drops

OVR: Packet overruns

An additional -c (continuous) option prints this summary every second.

The -s option prints network stack statistics. For example, on a busy production system (output truncated):

Click here to view code image


# netstat -s
Ip:
    Forwarding: 2
    454143446 total packets received
    0 forwarded
    0 incoming packets discarded
    454143446 incoming packets delivered
    487760885 requests sent out
    42 outgoing packets dropped
    2260 fragments received ok
    13560 fragments created
Icmp:
[...]
Tcp:
    359286 active connection openings
    9463980 passive connection openings
    12527 failed connection attempts
    14323 connection resets received
    13545 connections established
    453673963 segments received
    922299281 segments sent out
    127247 segments retransmitted
    0 bad segments received
    51660 resets sent
Udp:
[...]
TcpExt:
    21 resets received for embryonic SYN_RECV sockets
    12252 packets pruned from receive queue because of socket buffer overrun
    201219 TCP sockets finished time wait in fast timer
    11727438 delayed acks sent
    1445 delayed acks further delayed because of locked socket
    Quick ack mode was activated 17624 times
    169257582 packet headers predicted
    76058392 acknowledgments not containing data payload received
    111925821 predicted acknowledgments
    TCPSackRecovery: 1703
    Detected reordering 876 times using SACK
    Detected reordering 19 times using time stamp
    2 congestion windows fully recovered without slow start
[...]

This shows totals since boot. Much can be learned by studying this output: you can calculate packet rates for different protocols, connection rates (TCP active and passive), error rates, throughput, and other events. Some of the metrics I look for first I’ve highlighted in bold.

This output has human-readable descriptions of the metrics; it is not supposed to be parsed by other software, such as monitoring agents. Those should read the metrics directly from /proc/net/snmp and /proc/net/netstat instead (or even nstat(8)).

10.2.5 sar
The system activity reporter, sar(1), can print various network statistics reports. sar(1) can be used live, or configured to record data periodically as a monitoring tool. The networking options to sar(1) are:

-n DEV: Network interface statistics

-n EDEV: Network interface errors

-n IP,IP6: IPv4 and IPv6 datagram statistics

-n EIP,EIP6: IPv4 and IPv6 error statistics

-n ICMP,ICMP6: ICMP IPv4 and IPv6 statistics

-n EICMP,EICMP6: ICMP IPv4 and IPv6 error statistics

-n TCP: TCP statistics

-n ETCP: TCP error statistics

-n SOCK,SOCK6: IPv4 and IPv6 socket usage

As an example invocation, the following shows using four of these options on a production Hadoop instance, printed with an interval of one second:

Click here to view code image


# sar -n SOCK,TCP,ETCP,DEV 1
Linux 4.15.0-34-generic (...)       03/06/2019    _x86_64_      (36 CPU)

08:06:48 PM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s
rxmcst/s   %ifutil
08:06:49 PM      eth0 121615.00 108725.00 168906.73 149731.09      0.00      0.00
0.00     13.84
08:06:49 PM        lo    600.00    600.00  11879.12  11879.12      0.00      0.00
0.00      0.00

08:06:48 PM    totsck    tcpsck    udpsck    rawsck   ip-frag    tcp-tw
08:06:49 PM      2133       108         5         0         0      7134

08:06:48 PM  active/s passive/s    iseg/s    oseg/s
08:06:49 PM     16.00    134.00  15230.00 109267.00

08:06:48 PM  atmptf/s  estres/s retrans/s isegerr/s   orsts/s
08:06:49 PM      0.00      8.00      1.00      0.00     14.00
[...]

This multi-line output repeats for each interval. It can be used to determine:

The number of open TCP sockets (tcpsck)

The current TCP connection rate (active/s + passive/s)

The TCP retransmit rate (retrans/s / oseg/s)

Interfaces packet rates and throughput (rxpck/s + txpck/s, rxkB/s + txkB/s)

This is a cloud instance where I expect network interface errors to be zero: on physical servers, include the EDEV group to check for such errors.

10.2.6 nicstat
This tool prints network interface statistics and is modeled on iostat(1).5 For example:

5 Origin: I developed it for Solaris on 18-Jul-2004; Tim Cook developed the Linux version.

Click here to view code image


# nicstat 1
    Time      Int   rKB/s   wKB/s   rPk/s   wPk/s    rAvs    wAvs %Util    Sat
20:07:43     eth0  122190 81009.7 89435.8 61576.8  1399.0  1347.2  10.0    0.00
20:07:43       lo 13000.0 13000.0   646.7   646.7 20583.5 20583.5  0.00    0.00
    Time      Int   rKB/s   wKB/s   rPk/s   wPk/s    rAvs    wAvs %Util    Sat
20:07:44     eth0  268115 42283.6  185199 40329.2  1482.5  1073.6  22.0    0.00
20:07:44       lo  1869.3  1869.3   400.3   400.3  4782.1  4782.1  0.00    0.00
    Time      Int   rKB/s   wKB/s   rPk/s   wPk/s    rAvs    wAvs %Util    Sat
20:07:45     eth0  146194 40685.3  102412 33270.4  1461.8  1252.2  12.0    0.00
20:07:45       lo  1721.1  1721.1   109.1   109.1 16149.1 16149.1  0.00    0.00
[...]

This includes a saturation statistic, which combines different errors that indicate the level of interface saturation. A -U option will print separate read and write utilization percents, to determine if one direction is hitting limits.

10.2.7 ethtool
ethtool(8) can be used to check the static configuration of the network interfaces with -i and -k options, and also print driver statistics with -S. For example:

Click here to view code image


# ethtool -S eth0
NIC statistics:
     tx_timeout: 0
     suspend: 0
     resume: 0
     wd_expired: 0
     interface_up: 1
     interface_down: 0
     admin_q_pause: 0
     queue_0_tx_cnt: 100219217
     queue_0_tx_bytes: 84830086234
     queue_0_tx_queue_stop: 0
     queue_0_tx_queue_wakeup: 0
     queue_0_tx_dma_mapping_err: 0
     queue_0_tx_linearize: 0
     queue_0_tx_linearize_failed: 0
     queue_0_tx_napi_comp: 112514572
     queue_0_tx_tx_poll: 112514649
     queue_0_tx_doorbells: 52759561
[...]

This fetches statistics from the kernel ethtool framework, which many network device drivers support. Device drivers can define their own ethtool metrics.

The -i option shows driver details, and -k shows interface tunables. For example:

Click here to view code image


# ethtool -i eth0
driver: ena
version: 2.0.3K
[...]
# ethtool -k eth0
Features for eth0:
rx-checksumming: on
[...]
tcp-segmentation-offload: off
        tx-tcp-segmentation: off [fixed]
        tx-tcp-ecn-segmentation: off [fixed]
        tx-tcp-mangleid-segmentation: off [fixed]
        tx-tcp6-segmentation: off [fixed]
udp-fragmentation-offload: off
generic-segmentation-offload: on
generic-receive-offload: on
large-receive-offload: off [fixed]
rx-vlan-offload: off [fixed]
tx-vlan-offload: off [fixed]
ntuple-filters: off [fixed]
receive-hashing: on
highdma: on
[...]

This example is a cloud instance with the ena driver, and tcp-segmentation-offload is currently off. The -K option can be used to change these tunables.

10.2.8 tcpdump
Finally, tcpdump(8) can capture packets for study. This is termed “packet sniffing.” For example, sniffing interface en0 (-i) and writing (-w) to a dump file and then reading it (-r) without name resolution (-n)6:

6 It may cause additional network traffic for name resolution as an unwanted side effect of reading the file.

Click here to view code image


# tcpdump -i en0 -w /tmp/out.tcpdump01
tcpdump: listening on en0, link-type EN10MB (Ethernet), capture size 262144 bytes
^C451 packets captured
477 packets received by filter
0 packets dropped by kernel
# tcpdump -nr /tmp/out.tcpdump01
reading from file /tmp/out.tcpdump01, link-type EN10MB (Ethernet)
13:39:48.917870 IP 10.0.0.65.54154 > 69.53.1.1.4433: UDP, length 1357
13:39:48.921398 IP 108.177.1.2.443 > 10.0.0.65.59496: Flags [P.], seq
3108664869:3108664929, ack 2844371493, win 537, options [nop,nop,TS val 2521261
368 ecr 4065740083], length 60
13:39:48.921442 IP 10.0.0.65.59496 > 108.177.1.2.443: Flags [.], ack 60, win 505,
options [nop,nop,TS val 4065741487 ecr 2521261368], length 0
13:39:48.921463 IP 108.177.1.2.443 > 10.0.0.65.59496: Flags [P.], seq 0:60, ack 1,
win 537, options [nop,nop,TS val 2521261793 ecr 4065740083], length 60
[...]

tcpdump(8) output files can be read by other tools, including the Wireshark GUI [104]. Wireshark allows packet headers to be easily inspected, and TCP sessions to be “followed,” reassembling the transmit and receive bytes so that client/host interactions can be studied.

While packet capture has been optimized in the kernel and the libpcap library, at high rates it can still be expensive to perform, costing additional CPU overheads to collect, and CPU, memory, and disk resources to store, and then again to post-process. These overheads can be reduced somewhat by using a filter, so that only packets with certain header details are recorded. However, there are CPU overheads even for packets that are not collected.7 Since the filter expression must be applied to all packets, its processing must be efficient. This is the origin of Berkeley Packet Filter (BPF), which was created as a packet capture filter and later extended to become the technology I am using in this book for tracing tools. See Section 2.2 for an example of a tcpdump(8) filter program.

7 Every skb has to be cloned before it is handed to one of the packet handlers, and only later filtered (see dev_queue_xmit_nit()). BPF-based solutions can avoid the skb copy.

While packet capture tools may appear to show comprehensive details of networking, they only show details sent on the wire. They are blind to kernel state, including which processes are responsible for the packets, the stack traces, and kernel state of the sockets and TCP. Such details can be seen using BPF tracing tools.

10.2.9 /proc
Many of the prior statistic tools source metrics from /proc files, especially those in /proc/net. This directory can be explored at the command line:

Click here to view code image


$ ls /proc/net/
anycast6      if_inet6            ip_tables_names    ptype      sockstat6
arp           igmp                ip_tables_targets  raw        softnet_stat
bnep          igmp6               ipv6_route         raw6       stat/
connector     ip6_flowlabel       l2cap              rfcomm     tcp
dev           ip6_mr_cache        mcfilter           route      tcp6
dev_mcast     ip6_mr_vif          mcfilter6          rt6_stats  udp
dev_snmp6/    ip6_tables_matches  netfilter/         rt_acct    udp6
fib_trie      ip6_tables_names    netlink            rt_cache   udplite
fib_triestat  ip6_tables_targets  netstat            sco        udplite6
hci           ip_mr_cache         packet             snmp       unix
icmp          ip_mr_vif           protocols          snmp6      wireless
icmp6         ip_tables_matches   psched             sockstat   xfrm_stat
$ cat /proc/net/snmp
Ip: Forwarding DefaultTTL InReceives InHdrErrors InAddrErrors ForwDatagrams InUnknownProtos InDiscards InDelivers OutRequests OutDiscards OutNoRoutes ReasmTimeout ReasmReqds ReasmOKs ReasmFails FragOKs FragFails FragCreates
Ip: 2 64 45794729 0 28 0 0 0 45777774 40659467 4 6429 0 0 0 0 0 0 0
[...]

The netstat(1) and sar(1) tools expose many of these metrics. As shown earlier, they include system-wide statistics for packet rates, TCP active and passive new connections, TCP retransmits, ICMP errors, and much more.

There are also /proc/interrupts and /proc/softirqs, which can show the distribution of network device interrupts across CPUs. For example, on a two-CPU system:

Click here to view code image


$ cat /proc/interrupts
           CPU0       CPU1
[...]
 28:    1775400         80   PCI-MSI 81920-edge      ena-mgmnt@pci:0000:00:05.0
 29:        533    5501189   PCI-MSI 81921-edge      eth0-Tx-Rx-0
 30:    4526113        278   PCI-MSI 81922-edge      eth0-Tx-Rx-1
$ cat /proc/softirqs
                    CPU0       CPU1
[...]
      NET_TX:     332966         34
      NET_RX:   10915058   11500522
[...]

This system has an eth0 interface that uses the ena driver. The above output shows eth0 is using a queue for each CPU, and receive softirqs are spread across both CPUs. (Transmits appear unbalanced, but the network stack often skips this softirq and transmits directly to the device.) mpstat(8) also has an -I option to print interrupt statistics.

The BPF tools that follow have been created to extend, rather than duplicate, network observability beyond these /proc and traditional tool metrics. There is a BPF sockstat(8) for system-wide socket metrics, since those particular metrics are not available in /proc. But there is not a similar tcpstat(8), udpstat(8), or ipstat(8) tool for system-wide metrics: while it is possible to write these in BPF, such tools only need to use the already-maintained metrics in /proc. It is not even necessary to write those tools: netstat(1) and sar(1) provide that observability.

The following BPF tools extend observability by breaking down statistics by process ID, process name, IP address, and ports, revealing stack traces that led to events, exposing kernel state, and by showing custom latency measurements. It might appear that these tools are comprehensive: they are not. They are designed to be used with /proc/net and the earlier traditional tools, to extend observability.

10.3 BPF TOOLS
This section covers the BPF tools you can use for network performance analysis and troubleshooting. They are shown in Figure 10-4.


Figure 10-4 BPF tools for network analysis

bpftrace is shown in Figure 10-4 as observing device drivers. See Section 10.4.3 for examples. The other tools in this figure are from either the BCC or bpftrace repositories covered in Chapters 4 and 5, or were created for this book. Some tools appear in both BCC and bpftrace. Table 10-3 lists the origins of these tools (BT is short for bpftrace).

Table 10-3 Network-Related Tools

Tool

Source

Target

Description

sockstat

Book

Sockets

High-level socket statistics

sofamily

Book

Sockets

Count address families for new sockets, by process

soprotocol

Book

Sockets

Count transport protocols for new sockets, by process

soconnect

Book

Sockets

Trace socket IP-protocol connections with details

soaccept

Book

Sockets

Trace socket IP-protocol accepts with details

socketio

Book

Sockets

Summarize socket details with I/O counts

socksize

Book

Sockets

Show socket I/O sizes as per-process histograms

sormem

Book

Sockets

Show socket receive buffer usage and overflows

soconnlat

Book

Sockets

Summarize IP socket connection latency with stacks

so1stbyte

Book

Sockets

Summarize IP socket first byte latency

tcpconnect

BCC/BT/book

TCP

Trace TCP active connections (connect())

tcpaccept

BCC/BT/book

TCP

Trace TCP passive connections (accept())

tcplife

BCC/book

TCP

Trace TCP session lifespans with connection details

tcptop

BCC

TCP

Show TCP send/recv throughput by host

tcpretrans

BCC/BT

TCP

Trace TCP retransmits with address and TCP state

tcpsynbl

Book

TCP

Show TCP SYN backlog as a histogram

tcpwin

Book

TCP

Trace TCP send congestion window parameters

tcpnagle

Book

TCP

Trace TCP nagle usage and transmit delays

udpconnect

Book

UDP

Trace new UDP connections from localhost

gethostlatency

Book/BT

DNS

Trace DNS lookup latency via library calls

ipecn

Book

IP

Trace IP inbound explicit congestion notification

superping

Book

ICMP

Measure ICMP echo times from the network stack

qdisc-fq (...)

Book

qdiscs

Show FQ qdisc queue latency

netsize

Book

net

Show net device I/O sizes

nettxlat

Book

net

Show net device transmission latency

skbdrop

Book

skbs

Trace sk_buff drops with kernel stack traces

skblife

Book

skbs

Lifespan of sk_buff as inter-stack latency

ieee80211scan

Book

WiFi

Trace IEEE 802.11 WiFi scanning

For the tools from BCC and bpftrace, see their repositories for full and updated lists of tool options and capabilities. A selection of the most important capabilities is summarized here.

10.3.1 sockstat
sockstat(8)8 prints socket statistics along with counts for socket-related system calls each second. For example, on a production edge server:

8 Origin: I created it for this book on 14-Apr-2019.

Click here to view code image


# sockstat.bt
Attaching 10 probes...
Tracing sock statistics. Output every 1 second.
01:11:41
@[tracepoint:syscalls:sys_enter_bind]: 1
@[tracepoint:syscalls:sys_enter_socket]: 67
@[tracepoint:syscalls:sys_enter_connect]: 67
@[tracepoint:syscalls:sys_enter_accept4]: 89
@[kprobe:sock_sendmsg]: 5280
@[kprobe:sock_recvmsg]: 10547

01:11:42
[...]

A time is printed each second (e.g., “21:22:56”), followed by counts for various socket events. This example shows 10,547 sock_recvmsg() and 5280 sock_sendmsg() events per second, and fewer than one hundred accept4(2)s and connect(2)s.

The role of this tool is to provide high-level socket statistics for workload characterization, and starting points for further analysis. The output includes the probe name so that you can investigate further; for example, if you see a higher-than-expected rate of kprobe:sock_sendmsg events, the process name can be fetched using this bpftrace one-liner9:

9 Note for this and subsequent tools: applications can override their comm string by writing to /proc/self/comm.

Click here to view code image


# bpftrace -e 'kprobe:sock_sendmsg { @[comm] = count(); }'
Attaching 1 probe...
^C

@[sshd]: 1
@[redis-server]: 3
@[snmpd]: 6
@[systemd-resolve]: 28
@[java]: 17377

The user-level stack trace can also be inspected by adding ustack to the map key.

The sockstat(8) tool works by tracing key socket-related syscalls using tracepoints, and the sock_recvmsg() and sock_sendmsg() kernel functions using kprobes. The overhead of the kprobes is likely to be the most noticeable, and may become measurable on high network-throughput systems.

The source to sockstat(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing sock statistics. Output every 1 second.\n");
}

tracepoint:syscalls:sys_enter_accept*,
tracepoint:syscalls:sys_enter_connect,
tracepoint:syscalls:sys_enter_bind,
tracepoint:syscalls:sys_enter_socket*,
kprobe:sock_recvmsg,
kprobe:sock_sendmsg
{
        @[probe] = count();
}
interval:s:1
{
        time();
        print(@);
        clear(@);
}

The use of these kprobes is a shortcut. These could be traced using syscall tracepoints instead. The recvfrom(2), recvmsg(2), sendto(2), and sendmsg(2) syscalls, and other variants, can be traced by adding more tracepoints to the code. It becomes more complex with the read(2) and write(2) family of syscalls, where the file descriptor must be processed to determine the file type, to match on socket reads and writes only.

10.3.2 sofamily
sofamily(8)10 traces new socket connections via the accept(2) and connect(2) system calls and summarizes the process name and address family. This is useful for workload characterization: quantifying the load applied and looking for any unexpected socket usage that needs further investigation. For example, on a production edge server:

10 Origin: I created this tool for this book on 10-Apr-2019.

Click here to view code image


# sofamily.bt
Attaching 7 probes...
Tracing socket connect/accepts. Ctrl-C to end.
^C

@accept[sshd, 2, AF_INET]: 2
@accept[java, 2, AF_INET]: 420

@connect[sshd, 2, AF_INET]: 2
@connect[sshd, 10, AF_INET6]: 2
@connect[(systemd), 1, AF_UNIX]: 12
@connect[sshd, 1, AF_UNIX]: 34
@connect[java, 2, AF_INET]: 215

This output shows 420 AF_INET (IPv4) accepts and 215 connection attempts by Java while tracing, which is expected for this server. The output shows a map for socket accepts (@accept) and connects (@connect), with the keys process name, address family number, and the address family name for that number if known.

The address family number mappings (e.g., AF_INET == 2) is specific to Linux and is defined in the include/linux/socket.h header. (The table is included on the following pages.) Other kernels use their own number mappings.

Since the traced calls occur at a relatively low rate (compared to packet events), the overhead of this tool is expected to be negligible.

The source to sofamily(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/socket.h>

BEGIN
{
        printf("Tracing socket connect/accepts. Ctrl-C to end.\n");
        // from linux/socket.h:
        @fam2str[AF_UNSPEC] = "AF_UNSPEC";
        @fam2str[AF_UNIX] = "AF_UNIX";
        @fam2str[AF_INET] = "AF_INET";
        @fam2str[AF_INET6] = "AF_INET6";
}

tracepoint:syscalls:sys_enter_connect
{
        @connect[comm, args->uservaddr->sa_family,
            @fam2str[args->uservaddr->sa_family]] = count();
}

tracepoint:syscalls:sys_enter_accept,
tracepoint:syscalls:sys_enter_accept4
{
        @sockaddr[tid] = args->upeer_sockaddr;
}

tracepoint:syscalls:sys_exit_accept,
tracepoint:syscalls:sys_exit_accept4
/@sockaddr[tid]/
{
        if (args->ret > 0) {
                $sa = (struct sockaddr *)@sockaddr[tid];
                @accept[comm, $sa->sa_family, @fam2str[$sa->sa_family]] =
                    count();
        }
        delete(@sockaddr[tid]);
}

END
{
        clear(@sockaddr); clear(@fam2str);
}

The address family is read from the sa_family member of struct sockaddr. This is a number of type sa_family_t, which resolves to unsigned short. This tool includes the number on the output and also maps some common address families to string names to aid readability, based on this table from linux/socket.h:

Click here to view code image


/* Supported address families. */
#define AF_UNSPEC       0
#define AF_UNIX         1       /* Unix domain sockets          */
#define AF_LOCAL        1       /* POSIX name for AF_UNIX       */
#define AF_INET         2       /* Internet IP Protocol         */
#define AF_AX25         3       /* Amateur Radio AX.25          */
#define AF_IPX          4       /* Novell IPX                   */
#define AF_APPLETALK    5       /* AppleTalk DDP                */
#define AF_NETROM       6       /* Amateur Radio NET/ROM        */
#define AF_BRIDGE       7       /* Multiprotocol bridge         */
#define AF_ATMPVC       8       /* ATM PVCs                     */
#define AF_X25          9       /* Reserved for X.25 project    */
#define AF_INET6        10      /* IP version 6                 */
[..]

This header is included when running this bpftrace program, so that this line:

Click here to view code image

@fam2str[AF_INET] = "AF_INET";
becomes:

Click here to view code image

@fam2str[2] = "AF_INET";
mapping the number two to the string "AF_INET".

For the connect(2) syscall, all details are read on the syscall entry. The accept(2) syscalls are traced differently: the sockaddr pointer is saved in a hash and then retrieved on the exit of those syscalls to read the address family. This is because the sockaddr is populated during the syscall, so must be read at the end. The accept(2) return value is also checked (was it successful or not?); otherwise, the contents of the sockaddr struct would not be valid. This script could be enhanced to do a similar check for connect(2), so that the output counts are given only for successful new connections. The soconnect(8) tool shows the different return results for these connect(2) syscalls.

10.3.3 soprotocol
soprotocol(8)11 traces new socket connections and summarizes the process name and transport protocol. This is another workload characterization tool, for the transport protocol. For example, on a production edge server:

11 Origin: I created this tool for this book on 13-Apr-2019.

Click here to view code image


# soprotocol.bt
Attaching 4 probes...
Tracing socket connect/accepts. Ctrl-C to end.
^C

@accept[java, 6, IPPROTO_TCP, TCP]: 1171

@connect[setuidgid, 0, IPPROTO, UNIX]: 2
@connect[ldconfig, 0, IPPROTO, UNIX]: 2
@connect[systemd-resolve, 17, IPPROTO_UDP, UDP]: 79
@connect[java, 17, IPPROTO_UDP, UDP]: 80
@connect[java, 6, IPPROTO_TCP, TCP]: 559

This output shows 559 TCP accepts and 1171 TCP connects by Java while tracing. The output shows a map for socket accepts (@accept) and connects (@connect), with the keys: process name, protocol number, protocol name for that number if known, and protocol module name.

Since these calls happen at a relatively low rate (compared to packet events), the overhead of this tool is expected to be negligible.

The source to soprotocol(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>

BEGIN
{
        printf("Tracing socket connect/accepts. Ctrl-C to end.\n");
        // from include/uapi/linux/in.h:
        @prot2str[IPPROTO_IP] = "IPPROTO_IP";
        @prot2str[IPPROTO_ICMP] = "IPPROTO_ICMP";
        @prot2str[IPPROTO_TCP] = "IPPROTO_TCP";
        @prot2str[IPPROTO_UDP] = "IPPROTO_UDP";
}

kprobe:security_socket_accept,
kprobe:security_socket_connect
{
        $sock = (struct socket *)arg0;
        $protocol = $sock->sk->sk_protocol & 0xff;
        @connect[comm, $protocol, @prot2str[$protocol],
            $sock->sk->__sk_common.skc_prot->name] = count();
}

END
{
        clear(@prot2str);
}

This provides a short lookup table to translate protocol numbers into strings, and four common protocols. These are from the in.h header:

Click here to view code image


#if __UAPI_DEF_IN_IPPROTO
/* Standard well-defined IP protocols.  */
enum {
  IPPROTO_IP = 0,               /* Dummy protocol for TCP               */
#define IPPROTO_IP              IPPROTO_IP
  IPPROTO_ICMP = 1,             /* Internet Control Message Protocol    */
#define IPPROTO_ICMP            IPPROTO_ICMP
  IPPROTO_IGMP = 2,             /* Internet Group Management Protocol   */
#define IPPROTO_IGMP            IPPROTO_IGMP
  IPPROTO_IPIP = 4,             /* IPIP tunnels (older KA9Q tunnels use 94) */
#define IPPROTO_IPIP            IPPROTO_IPIP
  IPPROTO_TCP = 6,              /* Transmission Control Protocol        */
#define IPPROTO_TCP             IPPROTO_TCP
[...]

The bpftrace @prot2str table can be extended if needed.

The protocol module name, seen in the previous output as “TCP,” “UDP,” etc., is available as a string from the struct sock: __sk_common.skc_prot->name. This is convenient, and I’ve used this in other tools to print the transport protocol. Here is an an example from net/ipv4/tcp_ipv4.c:

Click here to view code image


struct proto tcp_prot = {
        .name                   = "TCP",
        .owner                  = THIS_MODULE,
        .close                  = tcp_close,
        .pre_connect            = tcp_v4_pre_connect,
[...]

The presence of this name field (.name = “TCP”) is a Linux kernel implementation detail. While convenient, it is possible that this .name member could change or vanish in future kernels. The transport protocol number, however, should always be present—which is why I included it in this tool as well.

The syscall tracepoints for accept(2) and connect(2) do not provide an easy path for fetching the protocol, and currently there are not any other tracepoints for these events. Without them, I have switched to using kprobes and chosen the LSM security_socket_* functions, which provide a struct sock as the first argument, and are a relatively stable interface.

10.3.4 soconnect
soconnect(8)12 shows IP protocol socket connect requests. For example:

12 Origin: I created this for the 2011 DTrace book [Gregg 11] and created this bpftrace version on 9-Apr-2019.

Click here to view code image


# soconnect.bt
Attaching 4 probes...
PID    PROCESS        FAM ADDRESS          PORT   LAT(us) RESULT
11448  ssh            2   127.0.0.1        22          43 Success
11449  ssh            2   10.168.188.1     22       45134 Success
11451  curl           2   100.66.96.2      53           6 Success
11451  curl           10  2406:da00:ff00::36d0:a866  80         3 Network unreachable
11451  curl           2   52.43.200.64     80           7 Success
11451  curl           2   52.39.122.191    80           3 Success
11451  curl           2   52.24.119.28     80          19 In progress
[...]

This shows two ssh(1) connections to port 22, followed by a curl(1) process that begins with a port 53 connection (DNS) and then an attempted IPv6 connection to port 80 that resulted in “network unreachable,” followed by successful IPv4 connections. The columns are:

PID: Process ID calling connect(2)

PROCESS: Process name calling connect(2)

FAM: Address family number (see the description in sofamily(8) earlier)

ADDRESS: IP address

PORT: Remote port

LAT(us): Latency (duration) of the connect(2) syscall only (see note below)

RESULT: Syscall error status

Note that IPv6 addresses can be so long that they cause the columns to overflow13 (as seen in this example).

13 You might wonder why I don’t just make the columns wider. If I did, it would cause wrapping for every line of output in this example, rather than just one. I try to keep the default output of all tools to less than 80 characters wide, so that it fits without problems in books, slides, emails, ticketing systems, and chat rooms. Some tools in BCC have a wide mode available, just to fit IPv6 neatly.

This works by instrumenting the connect(2) syscall tracepoints. One benefit is that these occur in process context, so you can reliably know who made the syscall. Compare this to the later tcpconnect(8) tool, which traces deeper in TCP and may or may not identify the process responsible. These connect(8) syscalls are also relatively low in frequency compared to packets and other events, and the overhead should be negligible.

The reported latency is for the connect() syscall only. For some applications, including the ssh(1) processes seen in the earlier output, this spans the network latency to establish a connection to the remote host. Other applications may create non-blocking sockets (SOCK_NONBLOCK), and the connect() syscall may return early before the connection is completed. This can be seen in the example output as the final curl(1) connection that results in an “In progress” result. To measure the full connection latency for these non-blocking calls requires instrumenting more events; an example is the later soconnlat(8) tool.

The source to soconnect(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/in.h>
#include <linux/in6.h>

BEGIN
{
        printf("%-6s %-16s FAM %-16s %-5s %8s %s\n", "PID", "PROCESS",
            "ADDRESS", "PORT", "LAT(us)", "RESULT");
        // connect(2) has more details:
        @err2str[0] = "Success";
        @err2str[EPERM] = "Permission denied";
        @err2str[EINTR] = "Interrupted";
        @err2str[EBADF] = "Invalid sockfd";
        @err2str[EAGAIN] = "Routing cache insuff.";
        @err2str[EACCES] = "Perm. denied (EACCES)";
        @err2str[EFAULT] = "Sock struct addr invalid";
        @err2str[ENOTSOCK] = "FD not a socket";
        @err2str[EPROTOTYPE] = "Socket protocol error";
        @err2str[EAFNOSUPPORT] = "Address family invalid";
        @err2str[EADDRINUSE] = "Local addr in use";
        @err2str[EADDRNOTAVAIL] = "No port available";
        @err2str[ENETUNREACH] = "Network unreachable";
        @err2str[EISCONN] = "Already connected";
        @err2str[ETIMEDOUT] = "Timeout";
        @err2str[ECONNREFUSED] = "Connect refused";
        @err2str[EALREADY] = "Not yet completed";
        @err2str[EINPROGRESS] = "In progress";
}

tracepoint:syscalls:sys_enter_connect
/args->uservaddr->sa_family == AF_INET ||
    args->uservaddr->sa_family == AF_INET6/
{
        @sockaddr[tid] = args->uservaddr;
        @start[tid] = nsecs;
}

tracepoint:syscalls:sys_exit_connect
/@start[tid]/
{
        $dur_us = (nsecs - @start[tid]) / 1000;
        printf("%-6d %-16s %-3d ", pid, comm, @sockaddr[tid]->sa_family);

        if (@sockaddr[tid]->sa_family == AF_INET) {
                $s = (struct sockaddr_in *)@sockaddr[tid];
                $port = ($s->sin_port >> 8) | (($s->sin_port << 8) & 0xff00);
                printf("%-16s %-5d %8d %s\n",
                    ntop(AF_INET, $s->sin_addr.s_addr),
                    $port, $dur_us, @err2str[- args->ret]);
        } else {
                $s6 = (struct sockaddr_in6 *)@sockaddr[tid];
                $port = ($s6->sin6_port >> 8) | (($s6->sin6_port << 8) & 0xff00);
                printf("%-16s %-5d %8d %s\n",
                    ntop(AF_INET6, $s6->sin6_addr.in6_u.u6_addr8),
                    $port, $dur_us, @err2str[- args->ret]);
        }

        delete(@sockaddr[tid]);
        delete(@start[tid]);
}

END
{
        clear(@start); clear(@err2str); clear(@sockaddr);
}

This records the struct sockaddr pointer when the syscall begins from args->uservaddr, along with a timestamp, so that these details can be fetched on the syscall exit. The sockaddr struct contains the connection details, but it must first be recast to the IPv4 sockaddr_in or the IPv6 sockaddr_in6 based on the sin_family member. A table of error codes that map to descriptions for connect(2) is used, based on the descriptions in the connect(2) man page.

The port number is flipped from network to host order using bitwise operations.

10.3.5 soaccept
soaccept(8)14 shows IP protocol socket accepts. For example:

14 Origin: I created this for the 2011 DTrace book [Gregg 11] and created this bpftrace version on 13-Apr-2019.

Click here to view code image


# soaccept.bt
Attaching 6 probes...
PID    PROCESS          FAM ADDRESS          PORT  RESULT
4225   java             2   100.85.215.60    65062 Success
4225   java             2   100.85.54.16     11742 Success
4225   java             2   100.82.213.228   18500 Success
4225   java             2   100.85.209.40    20150 Success
4225   java             2   100.82.21.89     27278 Success
4225   java             2   100.85.192.93    32490 Success
[...]

This shows many accepts by Java from different address. The port shown is the remote ephemeral port. See the later tcpaccept(8) tool for showing both endpoint ports. The columns are:

PID: Process ID calling connect(2)

COMM: Process name calling connect(2)

FAM: Address family number (see the description in Section 10.3.2)

ADDRESS: IP address

PORT: Remote port

RESULT: Syscall error status

This works by instrumenting the accept(2) syscall tracepoint. As with soconnect(8), this occurs in process context, so you can reliably identify who is making these accept(8) calls. These are also relatively low frequency compared to packets and other events, and the overhead should be negligible.

The source to soaccept(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/in.h>
#include <linux/in6.h>

BEGIN
{
        printf("%-6s %-16s FAM %-16s %-5s %s\n", "PID", "PROCESS",
            "ADDRESS", "PORT", "RESULT");
        // accept(2) has more details:
        @err2str[0] = "Success";
        @err2str[EPERM] = "Permission denied";
        @err2str[EINTR] = "Interrupted";
        @err2str[EBADF] = "Invalid sockfd";
        @err2str[EAGAIN] = "None to accept";
        @err2str[ENOMEM] = "Out of memory";
        @err2str[EFAULT] = "Sock struct addr invalid";
        @err2str[EINVAL] = "Args invalid";
        @err2str[ENFILE] = "System FD limit";
        @err2str[EMFILE] = "Process FD limit";
        @err2str[EPROTO] = "Protocol error";
        @err2str[ENOTSOCK] = "FD not a socket";
        @err2str[EOPNOTSUPP] = "Not SOCK_STREAM";
        @err2str[ECONNABORTED] = "Aborted";
        @err2str[ENOBUFS] = "Memory (ENOBUFS)";
}

tracepoint:syscalls:sys_enter_accept,
tracepoint:syscalls:sys_enter_accept4
{
        @sockaddr[tid] = args->upeer_sockaddr;
}

tracepoint:syscalls:sys_exit_accept,
tracepoint:syscalls:sys_exit_accept4
/@sockaddr[tid]/
{
        $sa = (struct sockaddr *)@sockaddr[tid];
        if ($sa->sa_family == AF_INET || $sa->sa_family == AF_INET6) {
                printf("%-6d %-16s %-3d ", pid, comm, $sa->sa_family);
                $error = args->ret > 0 ? 0 : - args->ret;

                if ($sa->sa_family == AF_INET) {
                        $s = (struct sockaddr_in *)@sockaddr[tid];
                        $port = ($s->sin_port >> 8) |
                            (($s->sin_port << 8) & 0xff00);
                        printf("%-16s %-5d %s\n",
                            ntop(AF_INET, $s->sin_addr.s_addr),
                            $port, @err2str[$error]);
                } else {
                        $s6 = (struct sockaddr_in6 *)@sockaddr[tid];
                        $port = ($s6->sin6_port >> 8) |
                            (($s6->sin6_port << 8) & 0xff00);
                        printf("%-16s %-5d %s\n",
                            ntop(AF_INET6, $s6->sin6_addr.in6_u.u6_addr8),
                            $port, @err2str[$error]);
                }
        }

        delete(@sockaddr[tid]);
}

END
{
        clear(@err2str); clear(@sockaddr);
}

This is similar to soconnect(8), processing and recasting the sockaddr on the return of the syscall. The error code descriptions have been changed, based on the descriptions in the accept(2) man page.

10.3.6 socketio
socketio(8)15 shows socket I/O counts by process, direction, protocol, and port. Example output:

15 Origin: I first created it as socketio.d for the 2011 DTrace book [Gregg 11], and I created the bpftrace version for this book on 11-Apr-2019.

Click here to view code image


# socketio.bt
Attaching 4 probes...
^C
@io[sshd, 13348, write, TCP, 49076]: 1
@io[redis-server, 2583, write, TCP, 41154]: 5
@io[redis-server, 2583, read, TCP, 41154]: 5
@io[snmpd, 1242, read, NETLINK, 0]: 6
@io[snmpd, 1242, write, NETLINK, 0]: 6
@io[systemd-resolve, 1016, read, UDP, 53]: 52
@io[systemd-resolve, 1016, read, UDP, 0]: 52
@io[java, 3929, read, TCP, 6001]: 1367
@io[java, 3929, write, TCP, 8980]: 24979
@io[java, 3929, read, TCP, 8980]: 44462

The final line in the output shows that Java PID 3929 performed 44,462 socket reads from TCP port 8980 while tracing. The five fields in each map key are process name, process ID, direction, protocol, and port.

This works by tracing the sock_recvmsg() and sock_sendmsg() kernel functions. To explain why I chose these functions, consider the socket_file_ops struct in net/socket.c:

Click here to view code image


/*
 *      Socket files have a set of 'special' operations as well as the generic file
ones. These don't appear
 *      in the operation structures but are done directly via the socketcall()
multiplexor.
 */

static const struct file_operations socket_file_ops = {
        .owner =        THIS_MODULE,
        .llseek =       no_llseek,
        .read_iter =    sock_read_iter,
        .write_iter =   sock_write_iter,
[...]

This code defines the socket read and write functions as sock_read_iter() and sock_write_iter(), and I tried tracing them first. But testing with a variety of workloads showed that tracing those particular functions was missing some events. The block comment in the code excerpt explains why: There are additional special operations that don’t appear in the operation struct, and these can also perform I/O on sockets. These include sock_recvmsg() and sock_sendmsg(), called directly via syscalls or other code paths, including sock_read_iter() and sock_write_iter(). This makes them a common point for tracing socket I/O.

For systems with busy network I/O, these socket functions may be called very frequently, causing the overhead to become measurable.

The source to socketio(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>

kprobe:sock_recvmsg
{
        $sock = (struct socket *)arg0;
        $dport = $sock->sk->__sk_common.skc_dport;
        $dport = ($dport >> 8) | (($dport << 8) & 0xff00);
        @io[comm, pid, "read", $sock->sk->__sk_common.skc_prot->name, $dport] =
            count();
}

kprobe:sock_sendmsg
{
        $sock = (struct socket *)arg0;
        $dport = $sock->sk->__sk_common.skc_dport;
        $dport = ($dport >> 8) | (($dport << 8) & 0xff00);
        @io[comm, pid, "write", $sock->sk->__sk_common.skc_prot->name, $dport] =
            count();
}

The destination port is big endian, and is converted to little endian (for this x86 processor) by the tool before inclusion in the @io map.16 This script could be modified to show the bytes transferred instead of the I/O counts; for an example, see the code in the following tool, socksize(8).

16 For this to work on big-endian processors, the tool should test for processor endianness and use a conversion only if necessary; for example, by use of #ifdef LITTLE_ENDIAN

socketio(8) is based on kprobes, which instruments kernel implementation details that may change, breaking the tool. With much more effort, it would be possible to rewrite this tool using syscall tracepoints instead. It will be necessary to trace sendto(2), sendmsg(2), sendmmsg(2), recvfrom(2), recvmsg(2), and recvmmsg(2). For some socket types, such as UNIX domain sockets, the read(2) and write(2) family of syscalls must also be traced. It would be easier to instrument tracepoints for socket I/O instead, however, they do not yet exist.

10.3.7 socksize
socksize(8)17 shows socket I/O counts and total bytes by process and direction. Example output from a 48-CPU production edge server:

17 Origin: I created it for this book on 12-Apr-2019, inspired by my disk I/O bitesize tool.

Click here to view code image


# socksize.bt
Attaching 2 probes...
^C

@read_bytes[sshd]:
[32, 64)               1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@read_bytes[java]:
[0]                  431 |@@@@@                                               |
[1]                    4 |                                                    |
[2, 4)                10 |                                                    |
[4, 8)               542 |@@@@@@                                              |
[8, 16)             3445 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@          |
[16, 32)            2635 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                    |
[32, 64)            3497 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@         |
[64, 128)            776 |@@@@@@@@@                                           |
[128, 256)           916 |@@@@@@@@@@@                                         |
[256, 512)          3123 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@              |
[512, 1K)           4199 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1K, 2K)            2972 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                |
[2K, 4K)            1863 |@@@@@@@@@@@@@@@@@@@@@@@                             |
[4K, 8K)            2501 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                      |
[8K, 16K)           1422 |@@@@@@@@@@@@@@@@@                                   |
[16K, 32K)           148 |@                                                   |
[32K, 64K)            29 |                                                    |
[64K, 128K)            6 |                                                    |

@write_bytes[sshd]:
[32, 64)               1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@write_bytes[java]:
[8, 16)               36 |                                                    |
[16, 32)               6 |                                                    |
[32, 64)            6131 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64, 128)           1382 |@@@@@@@@@@@                                         |
[128, 256)            30 |                                                    |
[256, 512)            87 |                                                    |
[512, 1K)            169 |@                                                   |
[1K, 2K)             522 |@@@@                                                |
[2K, 4K)            3607 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                      |
[4K, 8K)            2673 |@@@@@@@@@@@@@@@@@@@@@@                              |
[8K, 16K)            394 |@@@                                                 |
[16K, 32K)           815 |@@@@@@                                              |
[32K, 64K)           175 |@                                                   |
[64K, 128K)            1 |                                                    |
[128K, 256K)           1 |                                                    |

The main application is Java, and both reads and writes show a bimodal distribution of socket I/O sizes. There could be different reasons causing these modes: different code paths or message contents. The tool can be modified to include stack traces and application context to answer this.

socksize(8) works by tracing the sock_recvmsg() and sock_sendmsg() kernel functions, as does socketio(8). The source to socksize(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/fs.h>
#include <net/sock.h>

kprobe:sock_recvmsg,
kprobe:sock_sendmsg
{
        @socket[tid] = arg0;
}

kretprobe:sock_recvmsg
{
        if (retval < 0x7fffffff) {
                @read_bytes[comm] = hist(retval);
        }
        delete(@socket[tid]);
}

kretprobe:sock_sendmsg
{
        if (retval < 0x7fffffff) {
                @write_bytes[comm] = hist(retval);
        }
        delete(@socket[tid]);
}

END
{
        clear(@socket);
}

The return value of these functions contains either the bytes transferred or a negative error code. To filter the error codes, an if (retval >= 0) test would seem appropriate; however, retval is not type-aware: it is a 64-bit unsigned integer, whereas the sock_recvmsg() and sock_sendmsg() functions return a 32-bit signed integer. The solution should be to cast retval to its correct type using (int)retval, but int casts are not yet available in bpftrace, so the 0x7fffffff test is a workaround.18

18 bpftrace int casts have been prototyped by Bas Smit, and should be merged soon. See bpftrace PR #772.

More keys can be added if desired, such as the PID, port number, and user stack trace. The maps can also be changed from hist() to stats() to provide a different type of summary:

Click here to view code image


# socksize.bt
Attaching 2 probes...
^C

@read_bytes[sshd]: count 1, average 36, total 36
@read_bytes[java]: count 19874, average 1584, total 31486578

@write_bytes[sshd]: count 1, average 36, total 36
@write_bytes[java]: count 11061, average 3741, total 41379939

This shows the number of I/O (“count”), the average size in bytes (“average”), and the total throughput in bytes (“total”). During tracing, Java wrote 41 Mbytes.

10.3.8 sormem
sormem(8)19 traces the size of the socket receive queue, showing how full it is compared to the tunable limit, as histograms. If the receive queue exceeds the limit, packets are dropped, causing performance issues. For example, running this tool on a production edge server:

19 Origin: I created it for this book on 14-Apr-2019.

Click here to view code image


# sormem.bt
Attaching 4 probes...
Tracing socket receive buffer size. Hit Ctrl-C to end.
^C

@rmem_alloc:
[0]                72870 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                   |
[1]                    0 |                                                    |
[2, 4)                 0 |                                                    |
[4, 8)                 0 |                                                    |
[8, 16)                0 |                                                    |
[16, 32)               0 |                                                    |
[32, 64)               0 |                                                    |
[64, 128)              0 |                                                    |
[128, 256)             0 |                                                    |
[256, 512)             0 |                                                    |
[512, 1K)         113831 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1K, 2K)             113 |                                                    |
[2K, 4K)             105 |                                                    |
[4K, 8K)           99221 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@       |
[8K, 16K)          26726 |@@@@@@@@@@@@                                        |
[16K, 32K)         58028 |@@@@@@@@@@@@@@@@@@@@@@@@@@                          |
[32K, 64K)         31336 |@@@@@@@@@@@@@@                                      |
[64K, 128K)        15039 |@@@@@@                                              |
[128K, 256K)        6692 |@@@                                                 |
[256K, 512K)         697 |                                                    |
[512K, 1M)            91 |                                                    |
[1M, 2M)              45 |                                                    |
[2M, 4M)              80 |                                                    |

@rmem_limit:
[64K, 128K)        14447 |@                                                   |
[128K, 256K)         262 |                                                    |
[256K, 512K)           0 |                                                    |
[512K, 1M)             0 |                                                    |
[1M, 2M)               0 |                                                    |
[2M, 4M)               0 |                                                    |
[4M, 8M)               0 |                                                    |
[8M, 16M)         410158 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16M, 32M)             7 |                                                    |

@rmem_alloc shows how much memory has been allocated for the receive buffer. @rmem_limit is the limit size of the receive buffer, tunable using sysctl(8). This example shows that the limit is often in the eight- to 16-Mbyte range, whereas the memory actually allocated is much lower, often between 512 bytes and 256 Kbytes.

Here is a synthetic example to help explain this; an iperf(1) throughput test is performed with this sysctl(1) tcp_rmem setting (be careful when tuning this as larger sizes can introduce latency due to skb collapse and coalescing [105]):

Click here to view code image


# sysctl -w net.ipv4.tcp_rmem='4096 32768 10485760'
# sormem.bt
Attaching 4 probes...
Tracing socket receive buffer size. Hit Ctrl-C to end.
[...]

@rmem_limit:
[64K, 128K)           17 |                                                    |
[128K, 256K)       26319 |@@@@                                                |
[256K, 512K)          31 |                                                    |
[512K, 1M)             0 |                                                    |
[1M, 2M)              26 |                                                    |
[2M, 4M)               0 |                                                    |
[4M, 8M)               8 |                                                    |
[8M, 16M)         320047 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

And again with a reduction in the max rmem setting:

Click here to view code image


# sysctl -w net.ipv4.tcp_rmem='4096 32768 100000'
# sormem.bt
Attaching 4 probes...
Tracing socket receive buffer size. Hit Ctrl-C to end.
[...]

@rmem_limit:
[64K, 128K)       656221 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[128K, 256K)       34058 |@@                                                  |
[256K, 512K)          92 |                                                    |

The rmem_limit has now dropped to the 64- to 128-Kbyte range, matching the configured limit of 100 Kbytes. Note that net.ipv4.tcp_moderate_rcvbuf is enabled, which helps tune the receive buffer to reach this limit sooner.

This works by tracing the kernel sock_rcvmsg() function using kprobes, which might cause measurable overhead for busy workloads.

The source to sormem(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>

BEGIN
{
        printf("Tracing socket receive buffer size. Hit Ctrl-C to end.\n");
}

kprobe:sock_recvmsg
{
        $sock = ((struct socket *)arg0)->sk;
        @rmem_alloc = hist($sock->sk_backlog.rmem_alloc.counter);
        @rmem_limit = hist($sock->sk_rcvbuf & 0xffffffff);
}

tracepoint:sock:sock_rcvqueue_full
{
        printf("%s rmem_alloc %d > rcvbuf %d, skb size %d\n", probe,
            args->rmem_alloc, args->sk_rcvbuf, args->truesize);
}

tracepoint:sock:sock_exceed_buf_limit
{
        printf("%s rmem_alloc %d, allocated %d\n", probe,
            args->rmem_alloc, args->allocated);
}

There are two sock tracepoints that fire when buffer limits are exceeded, also traced in this tool.20 If they happen, per-event lines are printed with details. (In the prior outputs, these events did not occur.)

20 The tracepoint:sock:sock_exceed_buf_limit tracepoint was extended in newer kernels (by 5.0) with extra arguments: you can now filter on receive events only by adding the filter /args->kind == SK_MEM_RECV/.

10.3.9 soconnlat
soconnlat(8)21 shows socket connection latency as a histogram, with user-level stack traces. This provides a different view of socket usage: rather than identifying connections by their IP addresses and ports, as soconnect(8) does, this helps you identify connections by their code paths. Example output:

21 Origin: I created it for this book on 12-Apr-2019, inspired by my disk I/O bitesize tool.

Click here to view code image


# soconnlat.bt
Attaching 12 probes...
Tracing IP connect() latency with ustacks. Ctrl-C to end.
^C

@us[
    __GI___connect+108
    Java_java_net_PlainSocketImpl_socketConnect+368
    Ljava/net/PlainSocketImpl;::socketConnect+197
    Ljava/net/AbstractPlainSocketImpl;::doConnect+1156
    Ljava/net/AbstractPlainSocketImpl;::connect+476
    Interpreter+5955
    Ljava/net/Socket;::connect+1212
    Lnet/sf/freecol/common/networking/Connection;::<init>+324
    Interpreter+5955
    Lnet/sf/freecol/common/networking/ServerAPI;::connect+236
    Lnet/sf/freecol/client/control/ConnectController;::login+660
    Interpreter+3856
    Lnet/sf/freecol/client/control/ConnectController$$Lambda$258/1471835655;::run+92
    Lnet/sf/freecol/client/Worker;::run+628
    call_stub+138
    JavaCalls::call_helper(JavaValue*, methodHandle const&, JavaCallArguments*, Th...
    JavaCalls::call_virtual(JavaValue*, Handle, Klass*, Symbol*, Symbol*, Thread*)...
    thread_entry(JavaThread*, Thread*)+108
    JavaThread::thread_main_inner()+446
    Thread::call_run()+376
    thread_native_entry(Thread*)+238
    start_thread+208
    __clone+63
, FreeColClient:W]:
[32, 64)               1 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@us[
    __connect+71
, java]:
[128, 256)            69 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                       |
[256, 512)            28 |@@@@@@@@@@@@                                        |
[512, 1K)            121 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1K, 2K)              53 |@@@@@@@@@@@@@@@@@@@@@@                              |

This shows two stack traces: the first is from an open source Java game, and the code path shows why it was calling connect. There was only one occurrence of this codepath, with a connect latency of between 32 and 64 microseconds. The second stack shows over 200 connections, of between 128 microseconds and 2 milliseconds, from Java. This second stack trace is broken, however, showing only one frame “__connect+71” before abruptly ending. The reason is that this Java application is using the default libc library, which has been compiled without frame pointers. See Section 13.2.9 in Chapter 13 for ways to fix this.

This connection latency shows how long it took for the connection to be established across the network, which for TCP spans the three-way TCP handshake. It also includes remote host kernel latency to process an inbound SYN and respond: this usually happens very quickly in interrupt context, so the connection latency should be dominated by the network round trip times.

This tool works by tracing the connect(2), select(2), and poll(2) family of syscalls via their tracepoints. The overhead might become measurable on busy systems that frequently call select(2) and poll(2) syscalls.

The source to soconnlat(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <asm-generic/errno.h>
#include <linux/in.h>

BEGIN
{
        printf("Tracing IP connect() latency with ustacks. Ctrl-C to end.\n");
}

tracepoint:syscalls:sys_enter_connect
/args->uservaddr->sa_family == AF_INET ||
    args->uservaddr->sa_family == AF_INET6/
{
        @conn_start[tid] = nsecs;
        @conn_stack[tid] = ustack();
}

tracepoint:syscalls:sys_exit_connect
/@conn_start[tid] && args->ret != - EINPROGRESS/
{
        $dur_us = (nsecs - @conn_start[tid]) / 1000;
        @us[@conn_stack[tid], comm] = hist($dur_us);
        delete(@conn_start[tid]);
        delete(@conn_stack[tid]);
}

tracepoint:syscalls:sys_exit_poll*,
tracepoint:syscalls:sys_exit_epoll*,
tracepoint:syscalls:sys_exit_select*,
tracepoint:syscalls:sys_exit_pselect*
/@conn_start[tid] && args->ret > 0/
{
        $dur_us = (nsecs - @conn_start[tid]) / 1000;
        @us[@conn_stack[tid], comm] = hist($dur_us);
        delete(@conn_start[tid]);
        delete(@conn_stack[tid]);
}

END
{
        clear(@conn_start); clear(@conn_stack);
}

This solves the problem mentioned in the earlier description of the soconnect(8) tool. The connection latency is measured as the time for the connect(2) syscall to complete, unless it completes with an EINPROGRESS status, in which case the true connection completion occurs sometime later, when a poll(2) or select(2) syscall successfully finds an event for that file descriptor. What this tool should do is record the enter arguments of each poll(2) or select(2) syscall, then examine them again on exit to ensure that the connect socket file descriptor is the one that had the event. Instead, this tool takes a giant shortcut by assuming that the first successful poll(2) or select(2) after a connect(2) that is EINPROGRESS on the same thread is related. It probably is, but bear in mind that the tool may have a margin of error if the application called connect(2) and then—on the same thread—received an event on a different file descriptor that it was also waiting on. You can enhance the tool or investigate your application’s use of those syscalls to see how plausible that scenario may be.

For example, counting how many file descriptors applications are waiting for via poll(2), on a production edge server:

Click here to view code image


# bpftrace -e 't:syscalls:sys_enter_poll { @[comm, args->nfds] = count(); }'
Attaching 1 probe...
^C

@[python3, 96]: 181
@[java, 1]: 10300

During tracing, Java only calls poll(2) on one file descriptor, so the scenario I just described seems even less likely, unless it is calling poll(2) separately for different file descriptions. Similar tests can be performed for the other poll(2) and select(2) syscalls.

This output also caught python3 calling poll(2) on...96 file descriptors? By adding pid to the map key to identify which python3 process, and then examining its file descriptors in lsof(8), I found that it really does have 96 file descriptors open, by mistake, and is frequently polling them on production servers. I should be able to fix this and get some CPU cycles back.22

22 Before getting too excited, I checked the server uptime, CPU count, and process CPU usage via ps(1) (the process is supposed to be idle), to calculate how much CPU resources are wasted by this: it came out to only 0.02%.

10.3.10 so1stbyte
so1stbyte(8)23 traces the time from issuing an IP socket connect(2) to the first read byte for that socket. While soconnlat(8) is a measure of network and kernel latency to establish a connection, so1stbyte(8) includes the time for the remote host application to be scheduled and produce data. This provides a view of how busy the remote host is and, if measured over time, may reveal times when the remote hosts are more heavily loaded, and have higher latency. For example:

23 Origin: I first created so1stbyte.d for the 2011 DTrace book [Gregg 11]. I created this version on 16-Apr-2019.

Click here to view code image


# so1stbyte.bt
Attaching 21 probes...
Tracing IP socket first-read-byte latency. Ctrl-C to end.
^C

@us[java]:
[256, 512)             4 |                                                    |
[512, 1K)              5 |@                                                   |
[1K, 2K)              34 |@@@@@@                                              |
[2K, 4K)             212 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@          |
[4K, 8K)             260 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[8K, 16K)             35 |@@@@@@@                                             |
[16K, 32K)             6 |@                                                   |
[32K, 64K)             1 |                                                    |
[64K, 128K)            0 |                                                    |
[128K, 256K)           4 |                                                    |
[256K, 512K)           3 |                                                    |
[512K, 1M)             1 |                                                    |

This output shows that the connections from this Java process usually received their first bytes in one to 16 milliseconds.

This works by using the syscall tracepoints to instrument the connect(2), read(2), and recv(2) family of syscalls. The overhead may be measurable while running, as these syscalls can be frequent on high-I/O systems.

The source to so1stbyte(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <asm-generic/errno.h>
#include <linux/in.h>

BEGIN
{
        printf("Tracing IP socket first-read-byte latency. Ctrl-C to end.\n");
}

tracepoint:syscalls:sys_enter_connect
/args->uservaddr->sa_family == AF_INET ||
    args->uservaddr->sa_family == AF_INET6/
{
        @connfd[tid] = args->fd;
        @connstart[pid, args->fd] = nsecs;
}

tracepoint:syscalls:sys_exit_connect
{
        if (args->ret != 0 && args->ret != - EINPROGRESS) {
                // connect() failure, delete flag if present
                delete(@connstart[pid, @connfd[tid]]);
        }
        delete(@connfd[tid]);
}

tracepoint:syscalls:sys_enter_close
/@connstart[pid, args->fd]/
{
        // never called read
        delete(@connstart[pid, @connfd[tid]]);
}

tracepoint:syscalls:sys_enter_read,
tracepoint:syscalls:sys_enter_readv,
tracepoint:syscalls:sys_enter_pread*,
tracepoint:syscalls:sys_enter_recvfrom,
tracepoint:syscalls:sys_enter_recvmsg,
tracepoint:syscalls:sys_enter_recvmmsg
/@connstart[pid, args->fd]/
{
        @readfd[tid] = args->fd;
}

tracepoint:syscalls:sys_exit_read,
tracepoint:syscalls:sys_exit_readv,
tracepoint:syscalls:sys_exit_pread*,
tracepoint:syscalls:sys_exit_recvfrom,
tracepoint:syscalls:sys_exit_recvmsg,
tracepoint:syscalls:sys_exit_recvmmsg
/@readfd[tid]/
{
        $fd = @readfd[tid];
        @us[comm, pid] = hist((nsecs - @connstart[pid, $fd]) / 1000);
        delete(@connstart[pid, $fd]);
        delete(@readfd[tid]);
}

END
{
        clear(@connstart); clear(@connfd); clear(@readfd);
}

This tool records a starting timestamp in a @connstart map during the entry to connect(2), keyed by the process ID and file descriptor. If this connect(2) is a failure (unless it is non-blocking and returned with EINPROGRESS) or close(2) was issued, it deletes the timestamp to stop tracking that connection. When the first read or recv syscall is entered on the socket file descriptor seen earlier, it tracks the file descriptor in @readfd so that it can be fetched on syscall exit, and finally the starting time read from the @connstart map.

This timespan is similar to the TCP time to first byte described earlier, but with a small difference: the connect(2) duration is included.

Many syscall tracepoints need to be instrumented to catch the first read for the socket, adding overhead to all of those read paths. This overhead and the number of traced events could be reduced by switching instead to kprobes such as sock_recvmsg() for socket functions, and tracking the sock pointer as the unique ID rather than the PID and FD pair. The tradeoff would be that kprobes are not stable.

10.3.11 tcpconnect
tcpconnect(8)24 is a BCC and bpftrace tool to trace new TCP active connections. Unlike the earlier socket tools, tcpconnect(8) and the following TCP tools trace deeper in the network stack in the TCP code, rather than tracing the socket syscalls. tcpconnect(8) is named after the socket system call connect(2), and these are often termed outbound connections, although they may also be to localhost.

24 Origin: I created a similar tcpconnect.d tool for the 2011 DTrace book [Gregg 11], and I created the BCC version on 25-Sep-2015, and the tcpconnect-tp(8) bpftrace tracepoint version on 7-Apr-2019.

tcpconnect(8) is useful for workload characterization: determining who is connecting to whom, and at what rate. Here is tcpconnect(8) from BCC:

Click here to view code image


# tcpconnect.py -t
TIME(s)  PID    COMM         IP SADDR            DADDR            DPORT
0.000    4218   java         4  100.1.101.18     100.2.51.232     6001
0.011    4218   java         4  100.1.101.18     100.2.135.216    6001
0.072    4218   java         4  100.1.101.18     100.2.135.94     6001
0.073    4218   java         4  100.1.101.18     100.2.160.87     8980
0.124    4218   java         4  100.1.101.18     100.2.177.63     6001
0.212    4218   java         4  100.1.101.18     100.2.58.22      6001
0.214    4218   java         4  100.1.101.18     100.2.43.148     6001
[...]

This has caught several connections to different remote hosts with the same port, 6001. The columns are:

TIME(s): The time of the accept in seconds, counting from the first event seen.

PID: The process ID that accepted the connection. This is best-effort that matches on the current process; at the TCP level, these events may not happen in process context. For reliable PIDs, use socket tracing.

COMM: The process name that accepted the connection. As with PID, this is best-effort, and socket tracing should be used for better reliability.

IP: IP address protocol.

SADDR: Source address.

DADDR: Destination address.

DPORT: Destination port.

Both IPv4 and IPv6 are supported, although IPv6 addresses can be so wide that they can make the output columns untidy.

This works by tracing events related to creating new TCP sessions, rather than per-packet tracing. On this production server, the packet rate is around 50,000/s, whereas the new TCP session rate is around 350/s. By tracing session-level events instead of packets, the overhead is reduced by around a hundred fold, becoming negligible.

The BCC version currently works by tracing the tcp_v4_connect() and tcp_v6_connect() kernel functions. A future version should switch to using the sock:inet_sock_set_state tracepoint if available.

BCC
Command line usage:

tcpconnect [options]
Options include:

-t: Include a timestamp column

-p PID: Trace this process only

-P PORT[,PORT,...]: Trace these destination ports only

bpftrace
The following is the code for tcpconnect-tp(8), a bpftrace version of tcpconnect(8) that uses the sock:inet_sock_set_state tracepoint:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/tcp_states.h>
#include <linux/socket.h>

BEGIN
{
        printf("%-8s %-6s %-16s %-3s ", "TIME", "PID", "COMM", "IP");
        printf("%-15s %-15s %-5s\n", "SADDR", "DADDR", "DPORT");
}

tracepoint:sock:inet_sock_set_state
/args->oldstate == TCP_CLOSE && args->newstate == TCP_SYN_SENT/
{
        time("%H:%M:%S ");
        printf("%-6d %-16s %-3d ", pid, comm, args->family == AF_INET ? 4 : 6);
        printf("%-15s %-15s %-5d\n", ntop(args->family, args->saddr),
            ntop(args->family, args->daddr), args->dport)
}

This matches active opens by the transition from TCP_CLOSE to TCP_SYN_SENT.

The bpftrace repository has a tcpconnect(8)25 version for older Linux kernels that lack the sock:inet_sock_set_state tracepoint and traces the tcp_connect() kernel function instead.

25 Origin: This was created by Dale Hamel on 23-Nov-2018, for which he also added the ntop() builtin to bpftrace.

10.3.12 tcpaccept
tcpaccept(8)26 is a BCC and bpftrace tool to trace new TCP passive connections; it’s the counterpart to tcpconnect(8). It is named after the socket system call accept(2). These are often termed inbound connections, although they may also come from localhost. As with tcpconnect(8), this tool is useful for workload characterization: determining who is connecting to the local system, and at what rate.

26 Origin: I created a similar tcpaccept.d tool for the 2011 DTrace book [Gregg 11], and earlier versions in 2006 (tcpaccept1.d and tcpaccept2.d) which counted connections, that I created while I was developing the DTrace TCP provider [106]. I was up late finishing them to demo in my first-ever conference talk at CEC2006 in San Francisco [107] and then overslept and barely made it to the venue in time. I created the BCC version on 13-Oct-2015, and the tcpconnect-tp(8) version on 7-Apr-2019.

The following shows tcpaccept(8) from BCC, from a 48-CPU production instance, running with the -t option to print a timestamp column:

Click here to view code image


# tcpaccept -t
TIME(s)  PID     COMM         IP RADDR            RPORT LADDR            LPORT
0.000    4218    java         4  100.2.231.20     53422 100.1.101.18     6001
0.004    4218    java         4  100.2.236.45     36400 100.1.101.18     6001
0.013    4218    java         4  100.2.221.222    29836 100.1.101.18     6001
0.014    4218    java         4  100.2.194.78     40416 100.1.101.18     6001
0.016    4218    java         4  100.2.239.62     53422 100.1.101.18     6001
0.016    4218    java         4  100.2.199.236    28790 100.1.101.18     6001
0.021    4218    java         4  100.2.192.209    35840 100.1.101.18     6001
0.022    4218    java         4  100.2.215.219    21450 100.1.101.18     6001
0.026    4218    java         4  100.2.231.176    47024 100.1.101.18     6001
[...]

This output shows many new connections to local port 6001 from different remote addresses, which were accepted by a Java process with PID 4218. The columns are similar to those for tcpconnect(8), with these differences:

RADDR: Remote address

RPORT: Remote port

LADDR: Local address

LPORT: Local port

This tool works by tracing the inet_csk_accept() kernel function. This might sound like an unusual name compared with other high-level TCP functions, and you might wonder why I chose it. I chose it because it’s the accept function from the tcp_prot struct (net/ipv4/tcp_ipv4.c):

Click here to view code image


struct proto tcp_prot = {
        .name                   = "TCP",
        .owner                  = THIS_MODULE,
        .close                  = tcp_close,
        .pre_connect            = tcp_v4_pre_connect,
        .connect                = tcp_v4_connect,
        .disconnect             = tcp_disconnect,
        .accept                 = inet_csk_accept,
        .ioctl                  = tcp_ioctl,
[...]

IPv6 addresses are also supported, although the output columns can get untidy due to their width. As an example from a different production server:

Click here to view code image


# tcpaccept -t
TIME(s)  PID    COMM         IP RADDR            LADDR            LPORT
0.000    7013   java         6  ::ffff:100.1.54.4 ::ffff:100.1.58.46 13562
0.103    7013   java         6  ::ffff:100.1.7.19 ::ffff:100.1.58.46 13562
0.202    7013   java         6  ::ffff:100.1.58.59 ::ffff:100.1.58.46 13562
[...]

These addresses are IPv4 mapped over IPv6.

BCC
Command line usage:

tcpaccept [options]
tcpaccept(8) has similar options to tcpconnect(8), including:

-t: Include a timestamp column

-p PID: Trace this process only

-P PORT[,PORT,...]: Trace these local ports only

bpftrace
The following is the code for tcpaccept-tp(8), a bpftrace version of tcpaccept(8) developed for this book that uses the sock:inet_sock_set_state tracepoint:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/tcp_states.h>
#include <linux/socket.h>

BEGIN
{
        printf("%-8s %-3s %-14s %-5s %-14s %-5s\n", "TIME", "IP",
            "RADDR", "RPORT", "LADDR", "LPORT");
}

tracepoint:sock:inet_sock_set_state
/args->oldstate == TCP_SYN_RECV && args->newstate == TCP_ESTABLISHED/
{
        time("%H:%M:%S ");
        printf("%-3d %-14s %-5d %-14s %-5d\n", args->family == AF_INET ? 4 : 6,
            ntop(args->family, args->daddr), args->dport,
            ntop(args->family, args->saddr), args->sport);
}

Since the process ID is not expected to be on-CPU at the time of this TCP state transition, the pid and comm builtins have been elided from this version. Sample output:

Click here to view code image


# tcpaccept-tp.bt
Attaching 2 probes...
TIME     IP  RADDR          RPORT LADDR          LPORT
07:06:46 4   127.0.0.1      63998 127.0.0.1      28527
07:06:47 4   127.0.0.1      64002 127.0.0.1      28527
07:06:48 4   127.0.0.1      64004 127.0.0.1      28527
[...]

The bpftrace repository has a version of tcpaccept(8)27 that uses kernel dynamic tracing of the inet_csk_accept() function, as used by the BCC version. This function is expected to be application-process synchronous, so the PID and process name are printed using the pid and comm built-ins. An excerpt:

27 Origin: This was created by Dale Hamel on 23-Nov-2018.

Click here to view code image


[...]
kretprobe:inet_csk_accept
{
        $sk = (struct sock *)retval;
        $inet_family = $sk->__sk_common.skc_family;

        if ($inet_family == AF_INET || $inet_family == AF_INET6) {
                $daddr = ntop(0);
                $saddr = ntop(0);
                if ($inet_family == AF_INET) {
                        $daddr = ntop($sk->__sk_common.skc_daddr);
                        $saddr = ntop($sk->__sk_common.skc_rcv_saddr);
                } else {
                        $daddr = ntop(
                            $sk->__sk_common.skc_v6_daddr.in6_u.u6_addr8);
                        $saddr = ntop(
                            $sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr8);
                }
                $lport = $sk->__sk_common.skc_num;
                $dport = $sk->__sk_common.skc_dport;
                $qlen  = $sk->sk_ack_backlog;
                $qmax  = $sk->sk_max_ack_backlog;
[...]

The program fetches the protocol details from the sock struct. It also fetches tcp listen backlog details, and is an example of extending these tools to provide additional insights. This listen backlog was added to diagnose a Shopify production issue where Redis was degrading under peak load: it was found to be TCP listen drops.28 Adding a column to tcpaccept.bt made it possible to see the current length of the listen backlog, useful for characterization and capacity planning.

28 Production example provided by Dale Hamel.

A future change to bpftrace’s variable scoping may cause variables initialized in if-statement clauses to be scoped to the clause only, which would cause a problem for this program because $daddr and $saddr are then used outside of the clause. To avoid this future constraint, this program initializes these variables beforehand to ntop(0) (ntop(0) returns type inet, which is printed as a string.) This initialization is unnecessary in the current version of bpftrace (0.9.1), but has been included to make this program future-proof.

10.3.13 tcplife
tcplife(8)29 is a BCC and bpftrace tool to trace the lifespan of TCP sessions: showing their duration, address details, throughput, and when possible, the responsible process ID and name.

29 Origin: This began as a tweet from Julia Evans: “i really wish i had a command line tool that would give me stats on TCP connection lengths on a given port” [108]. In response I created tcplife(8) as a BCC tool on 18-Oct-2016, and I created the bpftrace version on 17-Apr-2019 after merging a needed bpftrace capability from Matheus Marchini that morning. This is one of the most popular tools I’ve developed. It forms the basis of several higher-level GUIs, as it provides efficient network flow stats that can be visualized as directed graphs.

The following shows tcplife(8) from BCC, from a 48-CPU production instance:

Click here to view code image


# tcplife
PID   COMM       LADDR           LPORT RADDR           RPORT TX_KB RX_KB  MS
4169  java       100.1.111.231   32648 100.2.0.48      6001      0     0  3.99
4169  java       100.1.111.231   32650 100.2.0.48      6001      0     0  4.10
4169  java       100.1.111.231   32644 100.2.0.48      6001      0     0  8.41
4169  java       100.1.111.231   40158 100.2.116.192   6001      7    33  3590.91
4169  java       100.1.111.231   56940 100.5.177.31    6101      0     0  2.48
4169  java       100.1.111.231   6001  100.2.176.45    49482     0     0  17.94
4169  java       100.1.111.231   18926 100.5.102.250   6101      0     0  0.90
4169  java       100.1.111.231   44530 100.2.31.140    6001      0     0  2.64
4169  java       100.1.111.231   44406 100.2.8.109     6001     11    28 3982.11
34781 sshd       100.1.111.231   22    100.2.17.121    41566     5     7 2317.30
4169  java       100.1.111.231   49726 100.2.9.217     6001     11    28 3938.47
4169  java       100.1.111.231   58858 100.2.173.248   6001      9    30 2820.51
[...]

This output shows a series of connections that were either short-lived (less than 20 milliseconds) or long-lived (over three seconds), as shown in the duration column “MS” for milliseconds). This is an application server pool that listens on port 6001. Most of the sessions in this screenshot show connections to port 6001 on remote application servers, with only one connection to the local port 6001. An ssh session was also seen, owned by sshd and local port 22—an inbound session.

This works by tracing TCP socket state change events, and prints the summary details when the state changes to TCP_CLOSE. These state-change events are much less frequent than packets, making this approach much less costly in overhead than per-packet sniffers. This has made tcplife(8) acceptable to run continuously as a TCP flow logger on Netflix production servers.

The original tcplife(8) traced the tcp_set_state() kernel function using kprobes. Since Linux 4.16, a tracepoint has been added for this purpose: sock:inet_sock_set_state. The tcplife(8) tool uses that tracepoint if available; otherwise, it defaults to the kprobe. There is a subtle difference between these events, which can be seen in the following one-liner. This counts the TCP state number for each event:

Click here to view code image


# bpftrace -e 'k:tcp_set_state { @kprobe[arg1] = count(); }
    t:sock:inet_sock_set_state { @tracepoint[args->newstate] = count(); }'
Attaching 2 probes...
^C

@kprobe[4]: 12
@kprobe[5]: 12
@kprobe[9]: 13
@kprobe[2]: 13
@kprobe[8]: 13
@kprobe[1]: 25
@kprobe[7]: 25

@tracepoint[3]: 12
@tracepoint[4]: 12
@tracepoint[5]: 12
@tracepoint[2]: 13
@tracepoint[9]: 13
@tracepoint[8]: 13
@tracepoint[7]: 25
@tracepoint[1]: 25

See it? The tcp_set_state() kprobe never sees state 3, which is TCP_SYN_RECV. This is because the kprobe is exposing the kernel implementation, and the kernel never calls tcp_set_state() with TCP_SYN_RECV: it doesn’t need to. This is an implementation detail that is normally hidden from end users. But with the addition of a tracepoint to expose these state changes, it was found to be confusing to leave out this state transition, so the tracepoint has been called to show all transitions.

BCC
Command line usage:

tcplife [options]
Options include:

-t: Include time column (HH:MM:SS)

-w: Wider columns (to better fit IPv6 addresses)

-p PID: Trace this process only

-L PORT[,PORT[,...]]: Trace only sessions with these local ports

-D PORT[,PORT[,...]]: Trace only sessions with these remote ports

bpftrace
The following is the code for the bpftrace version, developed for this book, and which summarizes its core functionality. This version uses a kprobe of tcp_set_state() so that it runs on older kernels, and does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/tcp_states.h>
#include <net/sock.h>
#include <linux/socket.h>
#include <linux/tcp.h>

BEGIN
{
        printf("%-5s %-10s %-15s %-5s %-15s %-5s ", "PID", "COMM",
            "LADDR", "LPORT", "RADDR", "RPORT");
        printf("%5s %5s %s\n", "TX_KB", "RX_KB", "MS");
}

kprobe:tcp_set_state
{
        $sk = (struct sock *)arg0;
        $newstate = arg1;

        /*
         * This tool includes PID and comm context. From TCP this is best
         * effort, and may be wrong in some situations. It does this:
         * - record timestamp on any state < TCP_FIN_WAIT1
         *      note some state transitions may not be present via this kprobe
         * - cache task context on:
         *      TCP_SYN_SENT: tracing from client
         *      TCP_LAST_ACK: client-closed from server
         * - do output on TCP_CLOSE:
         *      fetch task context if cached, or use current task
         */

        // record first timestamp seen for this socket
        if ($newstate < TCP_FIN_WAIT1 && @birth[$sk] == 0) {
                @birth[$sk] = nsecs;
        }

        // record PID & comm on SYN_SENT
        if ($newstate == TCP_SYN_SENT || $newstate == TCP_LAST_ACK) {
                @skpid[$sk] = pid;
                @skcomm[$sk] = comm;
        }

        // session ended: calculate lifespan and print
        if ($newstate == TCP_CLOSE && @birth[$sk]) {
                $delta_ms = (nsecs - @birth[$sk]) / 1000000;
                $lport = $sk->__sk_common.skc_num;
                $dport = $sk->__sk_common.skc_dport;
                $dport = ($dport >> 8) | (($dport << 8) & 0xff00);
                $tp = (struct tcp_sock *)$sk;
                $pid = @skpid[$sk];
                $comm = @skcomm[$sk];
                if ($comm == "") {
                        // not cached, use current task
                        $pid = pid;
                        $comm = comm;
                }

                $family = $sk->__sk_common.skc_family;
                $saddr = ntop(0);
                $daddr = ntop(0);
                if ($family == AF_INET) {
                        $saddr = ntop(AF_INET, $sk->__sk_common.skc_rcv_saddr);
                        $daddr = ntop(AF_INET, $sk->__sk_common.skc_daddr);
                } else {
                        // AF_INET6
                        $saddr = ntop(AF_INET6,
                            $sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr8);
                        $daddr = ntop(AF_INET6,
                            $sk->__sk_common.skc_v6_daddr.in6_u.u6_addr8);
                }
                printf("%-5d %-10.10s %-15s %-5d %-15s %-6d ", $pid,
                    $comm, $saddr, $lport, $daddr, $dport);
                printf("%5d %5d %d\n", $tp->bytes_acked / 1024,
                    $tp->bytes_received / 1024, $delta_ms);

                delete(@birth[$sk]);
                delete(@skpid[$sk]);
                delete(@skcomm[$sk]);
        }
}

END
{
        clear(@birth); clear(@skpid); clear(@skcomm);
}

The logic in this tool is somewhat complex, and I added block comments to explain it in both the BCC and bpftrace versions. What it does is:

Measure the time from the first state transition seen for the socket, to TCP_CLOSE. This is printed as the duration.

Fetch throughput statistics from the struct tcp_sock in the kernel. This avoids tracing each packet and summing throughput from their sizes. These throughput counters are relatively recent, added since 2015 [109].

Cache the process context on either TCP_SYN_SENT or TCP_LAST_ACK, or (if not cached by those) on TCP_CLOSE. This works reasonably well but relies on these events happening in process context, which is a kernel implementation detail. Future kernels could change their logic to make this approach much less reliable, at which point this tool would need to be updated to cache task context from socket events instead (see the earlier tools).

The BCC version of this tool has been extended by the Netflix network engineering team to record other useful fields from the sock and tcp_sock structs.

This bpftrace tool can be updated to use the sock:inet_sock_set_state tracepoint, which needs an additional check for args->protocol == IPPROTO_TCP as that tracepoint fires for more than just TCP. Using this tracepoint improves stability, but there will still be unstable parts: for example, transferred bytes still need to be fetched from the tcp_sock struct.

10.3.14 tcptop
tcptop(8)30 is a BCC tool that shows top processes using TCP. For example, from a 36-CPU production Hadoop instance:

30 Origin: I created tcptop using DTrace on 5-Jul-2005, inspired by William LeFebvre’s top(1) tool. I created the BCC version on 2-Sep-2016.

Click here to view code image


# tcptop
09:01:13 loadavg: 33.32 36.11 38.63 26/4021 123015

PID    COMM       LADDR                RADDR                 RX_KB  TX_KB
118119 java       100.1.58.46:36246    100.2.52.79:50010     16840      0
122833 java       100.1.58.46:52426    100.2.6.98:50010          0   3112
122833 java       100.1.58.46:50010    100.2.50.176:55396     3112      0
120711 java       100.1.58.46:50010    100.2.7.75:23358       2922      0
121635 java       100.1.58.46:50010    100.2.5.101:56426      2922      0
121219 java       100.1.58.46:50010    100.2.62.83:40570      2858      0
121219 java       100.1.58.46:42324    100.2.4.58:50010          0   2858
122927 java       100.1.58.46:50010    100.2.2.191:29338      2351      0
[...]

This output shows one connection at the top receiving over 16 Mbytes during this interval. By default, the screen is updated every second.

This works by tracing the TCP send and receive code path, and summarizing data in a BPF map efficiency. Even so, these events can be frequent, and on high network throughput systems the overhead may become measurable.

The actual functions traced are tcp_sendmsg() and tcp_cleanup_rbuf(). I chose tcp_cleanup_rbuf() as it provides both the sock struct and size as entry arguments. To get the same details from tcp_recvmsg() requires two kprobes and thus more overhead: a kprobe on entry for the sock struct, and a kretprobe for the returned bytes.

Note that tcptop(8) does not currently trace TCP traffic that was sent via the sendfile(2) syscall, as it may not call tcp_sendmsg(). If your workload makes use of sendfile(2), check for an updated tcptop(8) version or enhance it.

Command line usage:

Click here to view code image

tcptop [options] [interval [count]]
Options include:

-C: Don’t clear the screen

-p PID: Measure this process only

A future addition should be an option to truncate the number of rows shown.

10.3.15 tcpsnoop
tcpsnoop(8) was a popular Solaris DTrace tool of mine that I would have introduced at this point in this chapter if it existed for Linux BPF, but I have chosen not to port it; the version shown below is the Solaris one. I’m sharing it here because it taught me some important lessons the hard way.

tcpsnoop(8) printed a line for each packet, with addresses, packet size, process ID, and user ID. For example:

Click here to view code image


solaris# tcpsnoop.d
  UID    PID LADDR           LPORT DR RADDR           RPORT  SIZE CMD
    0    242 192.168.1.5        23 <- 192.168.1.1     54224    54 inetd
    0    242 192.168.1.5        23 -> 192.168.1.1     54224    54 inetd
    0    242 192.168.1.5        23 <- 192.168.1.1     54224    54 inetd
    0    242 192.168.1.5        23 <- 192.168.1.1     54224    78 inetd
    0    242 192.168.1.5        23 -> 192.168.1.1     54224    54 inetd
    0  20893 192.168.1.5        23 -> 192.168.1.1     54224    57 in.telnetd
    0  20893 192.168.1.5        23 <- 192.168.1.1     54224    54 in.telnetd
[...]

When I wrote this in 2004, network event analysis was the domain of packet sniffers: snoop(1M) for Solaris and tcpdump(8) for Linux. One blind spot of these tools is that they don’t show the process ID. I wanted a tool to show which process was creating network traffic, and this seemed like the obvious solution: create a version of snoop(1M) with a PID column. To test my solution, I ran it alongside snoop(1M) to ensure that they both saw the same packet events.

This turned out to be quite challenging: I needed to cache the PID during socket-level events, and fetch the packet size from the other end of the stack after MTU fragmentation. I needed to trace the data transfer code, the TCP handshake code, and other code for handling packets to closed ports and other events. I succeeded, but my tool traced eleven different points in the kernel, and walked various kernel structures, which made it very brittle as it relied on many unstable kernel details. The tool itself was over 500 lines of code.

Over a six-year span, the Solaris kernel was updated over a dozen times, and tcpsnoop(8) stopped working on seven of those updates. Fixing it became a nightmare: I could fix it for one kernel version, but I then had to test across all prior versions to see if the fix introduced a regression. It became impractical, and I began releasing separate tcpsnoop(8) versions for specific kernels.

There are two lessons here. First: kernel code is subject to change, and the more kprobes and struct usage you have, the more likely it is that your tool will break. The tools in this book purposely use the fewest possible kprobes, making maintenance easier when they do break. Where possible, use tracepoints instead.

Second: the entire premise of the tool was a mistake. If my aim was to identify which processes were causing network traffic, I did not need to do this on a per-packet basis. I could have written a tool to summarize data transfers only, bearing in mind that it would miss other packets including TCP handshakes—but it would have been close enough to solve most problems. By way of example, socketio(8) or tcptop(8), covered earlier, each use only two kprobes, and tcplife(8) uses one tracepoint plus some struct walking.

10.3.16 tcpretrans
tcpretrans(8)31 is a BCC and bpftrace tool to trace TCP retransmits, showing IP address and port details and the TCP state. The following shows tcpretrans(8) from BCC, on a production instance:

31 Origin: I created a number of similar TCP retransmit tracing tools using DTrace in 2011 [110]. I created an Ftrace-based tcpretrans(8) on 28-Jul-2014 [111], then the BCC tcpretrans(8) on 14-Feb-2016. Matthias Tafelmeier added the counting mode. Dale Hamel created the bpftrace version on 23-Nov-2018.

Click here to view code image


# tcpretrans
Tracing retransmits ... Hit Ctrl-C to end
TIME     PID    IP LADDR:LPORT         T> RADDR:RPORT         STATE
00:20:11 72475  4  100.1.58.46:35908   R> 100.2.0.167:50010   ESTABLISHED
00:20:11 72475  4  100.1.58.46:35908   R> 100.2.0.167:50010   ESTABLISHED
00:20:11 72475  4  100.1.58.46:35908   R> 100.2.0.167:50010   ESTABLISHED
00:20:12 60695  4  100.1.58.46:52346   R> 100.2.6.189:50010   ESTABLISHED
00:20:12 60695  4  100.1.58.46:52346   R> 100.2.6.189:50010   ESTABLISHED
00:20:12 60695  4  100.1.58.46:52346   R> 100.2.6.189:50010   ESTABLISHED
00:20:12 60695  4  100.1.58.46:52346   R> 100.2.6.189:50010   ESTABLISHED
00:20:13 60695  6  ::ffff:100.1.58.46:13562 R> ::ffff:100.2.51.209:47356 FIN_WAIT1
00:20:13 60695  6  ::ffff:100.1.58.46:13562 R> ::ffff:100.2.51.209:47356 FIN_WAIT1
[...]

This output shows a low rate of retransmits, a few per second (TIME column), which were mostly for sessions in the ESTABLISHED state. A high rate in the ESTABLISHED state can point to an external network problem. A high rate in the SYN_SENT state can point to an overloaded server application which is not consuming its SYN backlog fast enough.

This works by tracing TCP retransmit events in the kernel. Since these should occur infrequently, the overhead should be negligible. Compare this to how retransmits are historically analyzed using a packet sniffer to capture all packets, and then post-processing to find retransmits—both steps can cost significant CPU overhead. Packet-capture can also only see details that are on the wire, whereas tcpretrans(8) prints the TCP state directly from the kernel, and can be enhanced to print more kernel state if needed.

At Netflix, this tool was used to help diagnose a production issue caused by network traffic exceeding external network limits, causing dropped packets and retransmits. It was helpful to watch retransmits across different production instances, and be able to immediately see source, destination, and TCP state details without the overhead of processing per-packet dumps.

Shopify has also used this to debug a production network issue, where the workload was causing tcpdump(8) to drop so many packets that its output was not reliable, and the overhead was too painful. Both tcpretrans(8) and tcpdrop(8) (mentioned later) were used instead to gather enough information to point towards an external issue: in this case, it was a firewall configuration that became inundated under load and would drop packets.

BCC
Command line usage:

tcpretrans [options]
Options include:

-l: Include tail loss probe attempts (adds a kprobe for tcp_send_loss_probe())

-c: Counts retransmits per flow

The -c option changes the behavior of tcpretrans(8), causing it to print a summary of counts rather than per-event details.

bpftrace
The following is the code for the bpftrace version, which summarizes its core functionality. This version does not support options.

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/socket.h>
#include <net/sock.h>

BEGIN
{
        printf("Tracing TCP retransmits. Hit Ctrl-C to end.\n");
        printf("%-8s %-8s %20s %21s %6s\n", "TIME", "PID", "LADDR:LPORT",
            "RADDR:RPORT", "STATE");

        // See include/net/tcp_states.h:
        @tcp_states[1] = "ESTABLISHED";
        @tcp_states[2] = "SYN_SENT";
        @tcp_states[3] = "SYN_RECV";
        @tcp_states[4] = "FIN_WAIT1";
        @tcp_states[5] = "FIN_WAIT2";
        @tcp_states[6] = "TIME_WAIT";
        @tcp_states[7] = "CLOSE";
        @tcp_states[8] = "CLOSE_WAIT";
        @tcp_states[9] = "LAST_ACK";
        @tcp_states[10] = "LISTEN";
        @tcp_states[11] = "CLOSING";
        @tcp_states[12] = "NEW_SYN_RECV";
}

kprobe:tcp_retransmit_skb
{
        $sk = (struct sock *)arg0;
        $inet_family = $sk->__sk_common.skc_family;

        if ($inet_family == AF_INET || $inet_family == AF_INET6) {
                $daddr = ntop(0);
                $saddr = ntop(0);
                if ($inet_family == AF_INET) {
                        $daddr = ntop($sk->__sk_common.skc_daddr);
                        $saddr = ntop($sk->__sk_common.skc_rcv_saddr);
                } else {
                        $daddr = ntop(
                            $sk->__sk_common.skc_v6_daddr.in6_u.u6_addr8);
                        $saddr = ntop(
                            $sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr8);
                }
                $lport = $sk->__sk_common.skc_num;
                $dport = $sk->__sk_common.skc_dport;

                // Destination port is big endian, it must be flipped
                $dport = ($dport >> 8) | (($dport << 8) & 0x00FF00);

                $state = $sk->__sk_common.skc_state;
                $statestr = @tcp_states[$state];

                time("%H:%M:%S ");
                printf("%-8d %14s:%-6d %14s:%-6d %6s\n", pid, $saddr, $lport,
                    $daddr, $dport, $statestr);
        }
}

END
{
        clear(@tcp_states);
}

This version traces the tcp_retransmit_skb() kernel function. On Linux 4.15, tcp:tcp_retransmit_skb and tcp:tcp_retransmit_synack tracepoints were added, and this tool can be updated to use them.

10.3.17 tcpsynbl
tcpsynbl(8)32 traces the TCP SYN backlog limit and size, showing a histogram of the size measured each time the backlog is checked. For example, on a 48-CPU production edge server:

32 Origin: I created a number of similar TCP SYN backlog tools using DTrace in 2012 [110]. I created this bpftrace version on 19-Apr-2019.

Click here to view code image


# tcpsynbl.bt
Attaching 4 probes...
Tracing SYN backlog size. Ctrl-C to end.
^C
@backlog[backlog limit]: histogram of backlog size

@backlog[128]:
[0]                    2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|

@backlog[500]:
[0]                 2783 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[1]                    9 |                                                    |
[2, 4)                 4 |                                                    |
[4, 8)                 1 |                                                    |

The first histogram shows that a backlog of limit 128 had two connections arrive, where the backlog length was 0. The second histogram shows that a backlog limit of 500 had over two thousand connections arrive, and the length was usually zero, but sometimes reached the four to eight range. If the backlog exceeds the limit, this tool prints a line to say that a SYN has been dropped, which causes latency on the client host as it must retransmit.

This backlog size is tunable, and is an argument to the listen(2) syscall:

Click here to view code image

int listen(int sockfd, int backlog);
It is also truncated by a system limit set in /proc/sys/net/core/somaxconn.

This tool works by tracing new connection events, and checking the limit and size of the backlog. The overhead should be negligible, as these are usually infrequent compared to other events.

The source to tcpsynbl(8) is33:

33 This tool contains a workaround for an int casting problem: & 0xffffffff. This should become unnecessary in a later version of bpftrace.

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>

BEGIN
{
        printf("Tracing SYN backlog size. Ctrl-C to end.\n");
}

kprobe:tcp_v4_syn_recv_sock,
kprobe:tcp_v6_syn_recv_sock
{
        $sock = (struct sock *)arg0;
        @backlog[$sock->sk_max_ack_backlog & 0xffffffff] =
            hist($sock->sk_ack_backlog);
        if ($sock->sk_ack_backlog > $sock->sk_max_ack_backlog) {
                time("%H:%M:%S dropping a SYN.\n");
        }
}

END
{
        printf("\n@backlog[backlog limit]: histogram of backlog size\n");
}

If the backlog exceeds the limit, the time() builtin is used to print a line of output containing the time, and a message that a SYN was dropped. This was not seen in the previous production output as the limit was not exceeded.

10.3.18 tcpwin
tcpwin(8)34 traces the TCP send congestion window size and other kernel parameters, so that the performance of congestion control can be studied. This tool produces comma-separated value output for importing into graphing software. For example, running tcpwin.bt and saving the output to a text file:

34 Origin: I created this on 20-Apr-2019, inspired by the tcp_probe module and the many times I’ve seen it used for graphing congestion window size over time.

Click here to view code image


# tcpwin.bt > out.tcpwin01.txt

^C
# more out.tcpwin01.txt
Attaching 2 probes...
event,sock,time_us,snd_cwnd,snd_ssthresh,sk_sndbuf,sk_wmem_queued
rcv,0xffff9212377a9800,409985,2,2,87040,2304
rcv,0xffff9216fe306e80,534689,10,2147483647,87040,0
rcv,0xffff92180f84c000,632704,7,7,87040,2304
rcv,0xffff92180b04f800,674795,10,2147483647,87040,2304
[...]

The second line of output is a header line, and the following are event details. The second field is the sock struct address, which can be used to uniquely identify connections. The awk(1) utility can be used to frequency count these sock addresses:

Click here to view code image


# awk -F, '$1 == "rcv" { a[$2]++ } END { for (s in a) { print s, a[s] } }'
out.tcpwin01.txt
[...]
0xffff92166fede000 1
0xffff92150a03c800 4564
0xffff9213db2d6600 2
[...]

This shows that the socket with the most TCP receive events while tracing had the address 0xffff92150a03c800. Events for this address only, and the header line, can also be extracted by awk to a new file, out.csv:

Click here to view code image

# awk -F, '$2 == "0xffff92150a03c800" || NR == 2' out.tcpwin01.txt > out.csv
This CSV file was imported into the R statistics software and plotted (see Figure 10-5).


Figure 10-5 TCP congestion window and send buffer over time

This system is using the cubic TCP congestion control algorithm, showing an increase in send congestion window size and then a sharp drop when congestion is encountered (packet loss). This occurs several times, creating a sawtooth pattern, until an optimal window size is found.

The source to tcpwin(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>
#include <linux/tcp.h>

BEGIN
{
        printf("event,sock,time_us,snd_cwnd,snd_ssthresh,sk_sndbuf,");
        printf("sk_wmem_queued\n");
}

kprobe:tcp_rcv_established
{
        $sock = (struct sock *)arg0;
        $tcps = (struct tcp_sock *)arg0; // see tcp_sk()
        printf("rcv,0x%llx,%lld,%d,%d,%d,%d\n", arg0, elapsed / 1000,
            $tcps->snd_cwnd, $tcps->snd_ssthresh, $sock->sk_sndbuf,
            $sock->sk_wmem_queued);
}

This can be extended. The first field is the event type, but only “rcv” is used by this tool. You can add more kprobes or tracepoints, each with its own event string to identify it. For example, an event type “new” could be added when sockets are established, with fields to identify the IP addresses and TCP ports.

A kernel module was used for this type of congestion control analysis, tcp_probe, which recently has become a tracepoint: tcp:tcp_probe, in Linux 4.16. The tcpwin(8) tool can be rewritten to be based on this tracepoint, although not all socket details are visible from the tracepoint arguments.

10.3.19 tcpnagle
tcpnagle(8)35 traces the usage of TCP nagle on the TCP transmit codepath, and measures the duration of transmit delays as a histogram: these delays are caused by nagle and other events. For example, on a production edge server:

35 Origin: I created it for this book on 23-Apr-2019.

Click here to view code image


# tcpnagle.bt
Attaching 4 probes...
Tracing TCP nagle and xmit delays. Hit Ctrl-C to end.
^C

@blocked_us:
[2, 4)                 3 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)                 2 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                  |

@nagle[CORK]: 2
@nagle[OFF|PUSH]: 5
@nagle[ON]: 32
@nagle[PUSH]: 11418
@nagle[OFF]: 226697

During tracing, this showed that nagle was often off (perhaps because the application has called a setsockopt(2) with TCP_NODELAY) or set to push (perhaps because the application is using TCP_CORK). Only five times were transmit packets delayed, for at most the four to eight microsecond bucket.

This works by tracing the entry and exit of a TCP transmit function. This can be a frequent function, so the overhead may become noticeable on high network throughput systems.

The source to tcpnagle(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing TCP nagle and xmit delays. Hit Ctrl-C to end.\n");
        // from include/net/tcp.h; add more combinations if needed:
        @flags[0x0] = "ON";
        @flags[0x1] = "OFF";
        @flags[0x2] = "CORK";
        @flags[0x3] = "OFF|CORK";
        @flags[0x4] = "PUSH";
        @flags[0x5] = "OFF|PUSH";
}

kprobe:tcp_write_xmit
{
        @nagle[@flags[arg2]] = count();
        @sk[tid] = arg0;
}

kretprobe:tcp_write_xmit
/@sk[tid]/
{
        $inflight = retval & 0xff;
        $sk = @sk[tid];
        if ($inflight && !@start[$sk]) {
                @start[$sk] = nsecs;
        }
        if (!$inflight && @start[$sk]) {
                @blocked_us = hist((nsecs - @start[$sk]) / 1000);
                delete(@start[$sk]);
        }
        delete(@sk[tid]);
}

END
{
        clear(@flags); clear(@start); clear(@sk);
}

On the entry to tcp_write_xmit(), the nonagle flags (arg2) are converted to a readable string via the @flags lookup map. A sock struct point is also saved, as it is used in the kretprobe for saving timestamps with a connection for measuring the duration of transmit delays. The duration is measured from the first time tcp_write_xmit() returns non-zero (which shows that for some reason it did not send the packets; the reason may include nagle), to when tcp_write_xmit() next successfully sent packets for that socket.

10.3.20 udpconnect
udpconnect(8)36 traces new UDP connections initiated from the local host that use connect(2) (this does not trace unconnected UDP). For example:

36 Origin: I created it for this book on 20-Apr-2019.

Click here to view code image


# udpconnect.bt
Attaching 3 probes...
TIME     PID    COMM             IP RADDR            RPORT
20:58:38 6039   DNS Res~er #540  4  10.45.128.25     53
20:58:38 2621   TaskSchedulerFo  4  127.0.0.53       53
20:58:39 3876   Chrome_IOThread  6  2001:4860:4860::8888 53
[...]

This shows two connections, both to remote port 53, one from a DNS resolver, and the other from Chrome_IOThread.

This works by tracing the UDP connection functions in the kernel. Their frequency should be low, making the overhead negligible.

The source to udpconnect(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/sock.h>

BEGIN
{
        printf("%-8s %-6s %-16s %-2s %-16s %-5s\n", "TIME", "PID", "COMM",
            "IP", "RADDR", "RPORT");
}

kprobe:ip4_datagram_connect,
kprobe:ip6_datagram_connect
{
        $sa = (struct sockaddr *)arg1;
        if ($sa->sa_family == AF_INET || $sa->sa_family == AF_INET6) {
                time("%H:%M:%S ");
                if ($sa->sa_family == AF_INET) {
                        $s = (struct sockaddr_in *)arg1;
                        $port = ($s->sin_port >> 8) |
                            (($s->sin_port << 8) & 0xff00);
                        printf("%-6d %-16s 4  %-16s %-5d\n", pid, comm,
                            ntop(AF_INET, $s->sin_addr.s_addr), $port);
                } else {
                        $s6 = (struct sockaddr_in6 *)arg1;
                        $port = ($s6->sin6_port >> 8) |
                            (($s6->sin6_port << 8) & 0xff00);
                        printf("%-6d %-16s 6  %-16s %-5d\n", pid, comm,
                            ntop(AF_INET6, $s6->sin6_addr.in6_u.u6_addr8),
                            $port);
                }
        }
}

The ip4_datagram_connect() and ip6_datagram_connect() functions are the connect members of the udp_prot and udpv6_prot structs, which define the functions that handle the UDP protocol. Details are printed similarly to earlier tools.

Also see socketio(8) for a tool that shows UDP sends and receives by process. A UDP-specific one can be coded by tracing udp_sendmsg() and udp_recvmsg(), which would have the benefit of isolating the overhead to just the UDP functions rather than all the socket functions.

10.3.21 gethostlatency
gethostlatency(8)37 is a BCC and bpftrace tool to trace host resolution calls (DNS) via the resolver library calls, getaddrinfo(3), gethostbyname(3), etc. For example:

37 Origin: I created a similar tool called getaddrinfo.d for the 2011 DTrace book [Gregg 11]. I created the BCC version on 28-Jan-2016 and the bpftrace version on 8-Sep-2018.

Click here to view code image


# gethostlatency
TIME      PID    COMM                  LATms HOST
13:52:39  25511  ping                   9.65 www.netflix.com
13:52:42  25519  ping                   2.64 www.netflix.com
13:52:49  24989  DNS Res~er #712       43.09 docs.google.com
13:52:52  25527  ping                  99.26 www.cilium.io
13:52:53  19025  DNS Res~er #709        2.58 drive.google.com
13:53:05  21903  ping                 279.09 www.kubernetes.io
13:53:06  25459  TaskSchedulerFo       23.87 www.informit.com
[...]

This output shows the latencies of various resolutions system-wide. The first was the ping(1) command resolving www.netflix.com, which took 9.65 milliseconds. A subsequent lookup took 2.64 milliseconds (likely thanks to caching). Other threads and lookups can be seen in the output, with the slowest a 279 ms resolution of www.kubernetes.io.38

38 Slow DNS times for the .io domain from the United States is a known problem, believed to be due to the hosting location of the .io name servers [112].

This works by using user-level dynamic instrumentation on the library functions. During a uprobe the host name and a timestamp is recorded, and during a uretprobe the duration is calculated and printed with the saved name. Since these are typically low-frequency events, the overhead of this tool should be negligible.

DNS is a common source of production latency. At Shopify, the bpftrace version of this tool was executed on a Kubernetes cluster to characterize a DNS latency issue in production. The data did not point to an issue with a certain server or target of the lookup, but rather latency when many lookups were in flight. The issue was further debugged and found to be a cloud limit on the number of UDP sessions that could be open on each host. Increasing the limit resolved the issue.

BCC
Command line usage:

gethostlatency [options]
The only option currently supported is -p PID, to trace one process ID only.

bpftrace
The following is the code for the bpftrace version, which does not support options:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing getaddr/gethost calls... Hit Ctrl-C to end.\n");
        printf("%-9s %-6s %-16s %6s %s\n", "TIME", "PID", "COMM", "LATms",
            "HOST");
}

uprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
{
        @start[tid] = nsecs;
        @name[tid] = arg0;
}

uretprobe:/lib/x86_64-linux-gnu/libc.so.6:getaddrinfo,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname,
uretprobe:/lib/x86_64-linux-gnu/libc.so.6:gethostbyname2
/@start[tid]/
{
        $latms = (nsecs - @start[tid]) / 1000000;
        time("%H:%M:%S  ");
        printf("%-6d %-16s %6d %s\n", pid, comm, $latms, str(@name[tid]));
        delete(@start[tid]);
        delete(@name[tid]);
}

The different possible resolver calls are traced from libc via its /lib/x86_64-linux-gnu/libc.so.6 location. If a different resolver library is used, or if the functions are implemented by the application, or statically included (static build), then this tool will need to be modified to trace those other locations.

10.3.22 ipecn
ipecn(8)39 traces IPv4 inbound explicit congestion notification (ECN) events, and is a proof of concept tool. For example:

39 Origin: I created it for this book on 28-May-2019, based on a suggestion from Sargun Dhillon.

Click here to view code image


# ipecn.bt
Attaching 3 probes...
Tracing inbound IPv4 ECN Congestion Encountered. Hit Ctrl-C to end.
10:11:02 ECN CE from: 100.65.76.247
10:11:02 ECN CE from: 100.65.76.247
10:11:03 ECN CE from: 100.65.76.247
10:11:21 ECN CE from: 100.65.76.247
[...]

This shows congestion encountered (CE) events from 100.65.76.247. CE can be set by switches and routers in the network to notify endpoints of congestion. It can also be set by kernels based on a qdisc policy, although that is usually for testing and simulation purposes (with the netem qdisc). The DataCenter TCP (DCTCP) congestion control algorithm also makes use of ECN [Alizadeh 10] [113].

ipecn(8) works by tracing the kernel ip_rcv() function and reading the congestion encountered state from the IP header. Since this adds overhead to every received packet, this method is not ideal, and I’d rather call this a proof of concept. Much better would be to trace the kernel functions that handle CE events only, as these would fire less frequently. However, they are inlined and unavailable to trace directly (on my kernels). Best of all would be to have a tracepoint for ECN congestion encountered events.

The source to ipecn(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/skbuff.h>
#include <linux/ip.h>

BEGIN
{
        printf("Tracing inbound IPv4 ECN Congestion Encountered. ");
        printf("Hit Ctrl-C to end.\n");
}

kprobe:ip_rcv
{
        $skb = (struct sk_buff *)arg0;
        // get IPv4 header; see skb_network_header():
        $iph = (struct iphdr *)($skb->head + $skb->network_header);
        // see INET_ECN_MASK:
        if (($iph->tos & 3) == 3) {
                time("%H:%M:%S ");
                printf("ECN CE from: %s\n", ntop($iph->saddr));
        }
}

This is also an example of parsing the IPv4 header from a struct sk_buff. It uses similar logic to the kernel’s skb_network_header() function, and will need updates to match any changes to that function (another reason that more-stable tracepoints would be preferred). This tool can also be extended to trace the outbound path, and IPv6 (see Section 10.5).

10.3.23 superping
superping(8)40 measures the ICMP echo request to response latency from the kernel network stack, as a way to verify the round trip times reported by ping(8). Older versions of ping(8) measure the round trip time from user space, which can include CPU scheduling latency on busy systems, inflating the measured times. This older method is also used by ping(8) for kernels without socket timestamp support (SIOCGSTAMP or SO_TIMESTAMP).

40 Origin: I first created this for the 2011 DTrace book [Gregg 11] and wrote this version for this book on 20-Apr-2019.

Since I have a newer version of ping(8) and newer kernel, to demonstrate the older behavior I’ve run it with the -U option, which measures the original user-to-user latency. For example, in one terminal session:

Click here to view code image


terminal1# ping -U 10.0.0.1
PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=6.44 ms
64 bytes from 10.0.0.1: icmp_seq=2 ttl=64 time=6.60 ms
64 bytes from 10.0.0.1: icmp_seq=3 ttl=64 time=5.93 ms
64 bytes from 10.0.0.1: icmp_seq=4 ttl=64 time=7.40 ms
64 bytes from 10.0.0.1: icmp_seq=5 ttl=64 time=5.87 ms
[...]

While in another terminal session I had already run superping(8):

Click here to view code image


terminal2# superping.bt
Attaching 6 probes...
Tracing ICMP echo request latency. Hit Ctrl-C to end.
IPv4 ping, ID 28121 seq 1: 6392 us
IPv4 ping, ID 28121 seq 2: 6474 us
IPv4 ping, ID 28121 seq 3: 5811 us
IPv4 ping, ID 28121 seq 4: 7270 us
IPv4 ping, ID 28121 seq 5: 5741 us
[...]

The output can be compared: it shows that the times reported by ping(8) can be inflated by over 0.10 ms, for this current system and workload. Without -U, so that ping(8) uses socket timestamps, the time difference is often within 0.01 ms.

This works by instrumenting the send and receive of ICMP packets, saving a timestamp in a BPF map for each ICMP echo request, and compares the ICMP header details to match the echo packets. The overhead should be negligible, since this is only instrumenting raw IP packets and not TCP packets.

The source to superping(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <linux/skbuff.h>
#include <linux/icmp.h>
#include <linux/ip.h>
#include <linux/ipv6.h>
#include <linux/in.h>

BEGIN
{
        printf("Tracing ICMP ping latency. Hit Ctrl-C to end.\n");
}

/*
 * IPv4
 */
kprobe:ip_send_skb
{
        $skb = (struct sk_buff *)arg1;
        // get IPv4 header; see skb_network_header():
        $iph = (struct iphdr *)($skb->head + $skb->network_header);
        if ($iph->protocol == IPPROTO_ICMP) {
                // get ICMP header; see skb_transport_header():
                $icmph = (struct icmphdr *)($skb->head +
                    $skb->transport_header);
                if ($icmph->type == ICMP_ECHO) {
                        $id = $icmph->un.echo.id;
                        $seq = $icmph->un.echo.sequence;
                        @start[$id, $seq] = nsecs;
                }
        }
}

kprobe:icmp_rcv
{
        $skb = (struct sk_buff *)arg0;
        // get ICMP header; see skb_transport_header():
        $icmph = (struct icmphdr *)($skb->head + $skb->transport_header);
        if ($icmph->type == ICMP_ECHOREPLY) {
                $id = $icmph->un.echo.id;
                $seq = $icmph->un.echo.sequence;
                $start = @start[$id, $seq];
                if ($start > 0) {
                        $idhost = ($id >> 8) | (($id << 8) & 0xff00);
                        $seqhost = ($seq >> 8) | (($seq << 8) & 0xff00);
                        printf("IPv4 ping, ID %d seq %d: %d us\n",
                            $idhost, $seqhost, (nsecs - $start) / 1000);
                        delete(@start[$id, $seq]);
                }
        }
}

/*
 * IPv6
 */
kprobe:ip6_send_skb
{
        $skb = (struct sk_buff *)arg0;
        // get IPv6 header; see skb_network_header():
        $ip6h = (struct ipv6hdr *)($skb->head + $skb->network_header);
        if ($ip6h->nexthdr == IPPROTO_ICMPV6) {
                // get ICMP header; see skb_transport_header():
                $icmp6h = (struct icmp6hdr *)($skb->head +
                    $skb->transport_header);
                if ($icmp6h->icmp6_type == ICMPV6_ECHO_REQUEST) {
                        $id = $icmp6h->icmp6_dataun.u_echo.identifier;
                        $seq = $icmp6h->icmp6_dataun.u_echo.sequence;
                        @start[$id, $seq] = nsecs;
                }
        }
}

kprobe:icmpv6_rcv
{
        $skb = (struct sk_buff *)arg0;
        // get ICMPv6 header; see skb_transport_header():
        $icmp6h = (struct icmp6hdr *)($skb->head + $skb->transport_header);
        if ($icmp6h->icmp6_type == ICMPV6_ECHO_REPLY) {
                $id = $icmp6h->icmp6_dataun.u_echo.identifier;
                $seq = $icmp6h->icmp6_dataun.u_echo.sequence;
                $start = @start[$id, $seq];
                if ($start > 0) {
                        $idhost = ($id >> 8) | (($id << 8) & 0xff00);
                        $seqhost = ($seq >> 8) | (($seq << 8) & 0xff00);
                        printf("IPv6 ping, ID %d seq %d: %d us\n",
                            $idhost, $seqhost, (nsecs - $start) / 1000);
                        delete(@start[$id, $seq]);
                }
        }
}

END { clear(@start); }

Both IPv4 and IPv6 are handled by different kernel functions, and are traced separately. This code is another example of packet header analysis: the IPv4, IPv6, ICMP, and ICMPv6 packet headers are read by BPF. The method of finding these header structures from the struct sk_buff depends on the kernel source and its functions skb_network_header() and skb_transport_header(). As with kprobes, this is an unstable interface, and changes to how headers are found and processed by the network stack will require updates to this tool to match.

A minor note for this source: the ICMP identifier and sequence number are printed out after switching from network to host order (see $idhost = and $seqhost =). For the @start map that saves timestamps, I used the network order instead; this saved some instructions on the send kprobes.

10.3.24 qdisc-fq
qdisc-fq(8)41 shows the time spent on the Fair Queue (FQ) qdisc. For example, from a busy production edge server:

41 Origin: I created it for this book on 21-Apr-2019.

Click here to view code image


# qdisc-fq.bt
Attaching 4 probes...
Tracing qdisc fq latency. Hit Ctrl-C to end.
^C

@us:
[0]                 6803 |@@@@@@@@@@@@                                        |
[1]                20084 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                 |
[2, 4)             29230 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[4, 8)               755 |@                                                   |
[8, 16)              210 |                                                    |
[16, 32)              86 |                                                    |
[32, 64)              39 |                                                    |
[64, 128)             90 |                                                    |
[128, 256)            65 |                                                    |
[256, 512)            61 |                                                    |
[512, 1K)             26 |                                                    |
[1K, 2K)               9 |                                                    |
[2K, 4K)               2 |                                                    |

This shows that packets usually spent less than four microseconds on this queue, with a very small percentage reaching up to the two to four-millisecond bucket. Should there be a problem with queue latency, it will show up as higher latencies in the histogram.

This works by tracing the enqueue and dequeue functions for this qdisc. For high network I/O systems, the overhead may become measurable as these can be frequent events.

The source to qdisc-fq(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing qdisc fq latency. Hit Ctrl-C to end.\n");
}

kprobe:fq_enqueue
{
        @start[arg0] = nsecs;
}

kretprobe:fq_dequeue
/@start[retval]/
{
        @us = hist((nsecs - @start[retval]) / 1000);
        delete(@start[retval]);
}

END
{
        clear(@start);
}

The argument to fq_enqueue(), and the return value of fq_dequeue(), is the struct sk_buff address, which is used as a unique key for storing the timestamp.

Note that this tool only works when the FQ qdisc scheduler is loaded. If it is not, this tool will error:

Click here to view code image


# qdisc-fq.bt
Attaching 4 probes...
cannot attach kprobe, Invalid argument
Error attaching probe: 'kretprobe:fq_dequeue'

This can be fixed by forcibly loading the FQ scheduler kernel module:

Click here to view code image


# modprobe sch_fq
# qdisc-fq.bt
Attaching 4 probes...
Tracing qdisc fq latency. Hit Ctrl-C to end.
^C
#

Although, if this qdisc is not in use, then there will be no queueing events to measure. Use tc(1) to add and administer qdisc schedulers.

10.3.25 qdisc-cbq, qdisc-cbs, qdisc-codel, qdisc-fq_codel, qdisc-red, and qdisc-tbf
There are many other qdisc schedulers, and the previous qdisc-fq(8) tool can usually be adapted to trace each. For example, here is a Class Based Queueing (CBQ) version:

Click here to view code image


# qdisc-cbq.bt
Attaching 4 probes...
Tracing qdisc cbq latency. Hit Ctrl-C to end.
^C

@us:
[0]                  152 |@@                                                  |
[1]                  766 |@@@@@@@@@@@@@@                                      |
[2, 4)              2033 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@             |
[4, 8)              2279 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        |
[8, 16)             2663 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[16, 32)             427 |@@@@@@@@                                            |
[32, 64)              15 |                                                    |
[64, 128)              1 |                                                    |

The enqueue and dequeue functions that are traced are from struct Qdisc_ops, which defines their arguments and return value (include/net/sch_generic.h):

Click here to view code image


struct Qdisc_ops {
        struct Qdisc_ops        *next;
        const struct Qdisc_class_ops    *cl_ops;
        char                    id[IFNAMSIZ];
        int                     priv_size;
        unsigned int            static_flags;


        int                     (*enqueue)(struct sk_buff *skb,
                                           struct Qdisc *sch,
                                           struct sk_buff **to_free);
        struct sk_buff *        (*dequeue)(struct Qdisc *);
[...]

This is why the skb_buff address was the first argument for the enqueue function, and the return value of the dequeue function.

This Qdisc_ops is declared for other schedulers. For the CBQ qdisc (net/sched/sch_cbq.c):

Click here to view code image


static struct Qdisc_ops cbq_qdisc_ops __read_mostly = {
        .next           =       NULL,
        .cl_ops         =       &cbq_class_ops,
        .id             =       "cbq",
        .priv_size      =       sizeof(struct cbq_sched_data),
        .enqueue        =       cbq_enqueue,
        .dequeue        =       cbq_dequeue,
[...]

A qdisc-cbq.bt tool can thus be written by changing qdisc-fq(8)’s fq_enqueue to cbq_enqueue, and fq_dequeue to cbq_dequeue. is Here is a table of substitutions for some of the qdiscs:

BPF Tool

Qdisc

Enqueue Function

Dequeue Function

qdisc-cbq.bt

Class Based Queueing

cbq_enqueue()

cbq_dequeue()

qdisc-cbs.bt

Credit Based Shaper

cbs_enqueue())

cbs_dequeue()

qdisc-codel.bt

Controlled-Delay Active Queue Management

codel_qdisc_enqueue()

codel_qdisc_dequeue()

qdisc-fq_codel.bt

Fair Queueing with Controlled Delay

fq_codel_enqueue()

fq_codel_dequeue()

qdisc-red

Random Early Detection

red_enqueue()

red_dequeue()

qdisc-tbf

Token Bucket Filter

tbf_enqueue()

tbf_dequeue()

It would be a straightforward exercise to create a shell script wrapper to bpftrace, called qdisclat, that accepted a qdisc name as an argument and then built and ran the bpftrace program to show its latency.

10.3.26 netsize
netsize(8)42 shows the size of received and sent packets from the net device layer, both before and after software segmentation offload (GSO and GRO). This output can be used to investigate how packets become segmented before sending. For example, from a busy production server:

42 Origin: I created this for this book on 21-Apr-2019.

Click here to view code image


# netsize.bt
Attaching 5 probes...
Tracing net device send/receive. Hit Ctrl-C to end.
^C

@nic_recv_bytes:
[32, 64)           16291 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64, 128)            668 |@@                                                  |
[128, 256)            19 |                                                    |
[256, 512)            18 |                                                    |
[512, 1K)             24 |                                                    |
[1K, 2K)             157 |                                                    |


@nic_send_bytes:
[32, 64)             107 |                                                    |
[64, 128)            356 |                                                    |
[128, 256)           139 |                                                    |
[256, 512)            31 |                                                    |
[512, 1K)             15 |                                                    |
[1K, 2K)           45850 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|


@recv_bytes:
[32, 64)           16417 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[64, 128)            688 |@@                                                  |
[128, 256)            20 |                                                    |
[256, 512)            33 |                                                    |
[512, 1K)             35 |                                                    |
[1K, 2K)             145 |                                                    |
[2K, 4K)               1 |                                                    |
[4K, 8K)               5 |                                                    |
[8K, 16K)              3 |                                                    |
[16K, 32K)             2 |                                                    |


@send_bytes:
[32, 64)             107 |@@@                                                 |
[64, 128)            356 |@@@@@@@@@@@                                         |
[128, 256)           139 |@@@@                                                |
[256, 512)            29 |                                                    |
[512, 1K)             14 |                                                    |
[1K, 2K)             131 |@@@@                                                |
[2K, 4K)             151 |@@@@@                                               |
[4K, 8K)             269 |@@@@@@@@                                            |
[8K, 16K)            391 |@@@@@@@@@@@@@                                       |
[16K, 32K)          1563 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32K, 64K)           494 |@@@@@@@@@@@@@@@@                                    |

The output shows the packet sizes at the NIC (@nic_recv_bytes, @nic_send_bytes), and the packet sizes for the kernel network stack (@recv_bytes, @send_bytes). This shows that the server was receiving small packets, often smaller than 64 bytes, and mostly sending in the eight- to 64-Kbyte range (which becomes a one- to two-Kbyte range after segmentation for the NIC). These are likely 1500 MTU sends.

This interface does not support TCP segmentation offload (TSO), so the GSO was used to segment before delivery to the NIC. If TSO was supported and enabled, the @nic_send_bytes histogram would also show large sizes, as segmentation happens later in NIC hardware.

Switching to jumbo frames will increase the packet size and system throughput, although there can be issues with enabling jumbo frames in a datacenter, including consuming more switch memory and worsening TCP incast issues.

This output can be compared to the earlier output of socksize(8).

This works by tracing net device tracepoints and summarizing the length argument in BPF maps. The overhead may become measurable on high network I/O systems.

There is a Linux tool called iptraf-ng(8) that also shows histograms for network packet sizes. However, iptraf-ng(8) works by packet sniffing and processing packets in user space. This costs more CPU overhead than netsize(8), which summarizes in kernel space. For example, examining the CPU usage of each tool during a localhost iperf(1) benchmark:

Click here to view code image


# pidstat -p $(pgrep iptraf-ng) 1
Linux 4.15.0-47-generic (lgud-bgregg)     04/22/2019     _x86_64_       (8 CPU)

11:32:15 AM  UID    PID    %usr %system  %guest   %wait    %CPU  CPU Command
11:32:16 AM    0  30825   18.00   74.00    0.00    0.00   92.00    2 iptraf-ng
11:32:17 AM    0  30825   21.00   70.00    0.00    0.00   91.00    1 iptraf-ng
11:32:18 AM    0  30825   21.00   71.00    0.00    1.00   92.00    6 iptraf-ng
[...]
# pidstat -p $(pgrep netsize) 1
Linux 4.15.0-47-generic (lgud-bgregg)     04/22/2019     _x86_64_       (8 CPU)

11:33:39 AM  UID    PID    %usr %system  %guest   %wait    %CPU  CPU Command
11:33:40 AM    0  30776    0.00    0.00    0.00    0.00    0.00    5 netsize.bt
11:33:41 AM    0  30776    0.00    0.00    0.00    0.00    0.00    7 netsize.bt
11:33:42 AM    0  30776    0.00    0.00    0.00    0.00    0.00    1 netsize.bt
[...]

iptraf-ng(8) consumes over 90% of one CPU to summarize packet sizes as histograms, whereas netsize(8) consumes 0%. This highlights a key difference between the approaches, although there are additional overheads not shown here for kernel processing.

The source to netsize(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing net device send/receive. Hit Ctrl-C to end.\n");
}

tracepoint:net:netif_receive_skb
{
        @recv_bytes = hist(args->len);
}

tracepoint:net:net_dev_queue
{
        @send_bytes = hist(args->len);
}

tracepoint:net:napi_gro_receive_entry
{
        @nic_recv_bytes = hist(args->len);
}

tracepoint:net:net_dev_xmit
{
        @nic_send_bytes = hist(args->len);
}

This uses the net tracepoints to watch the send path and receive paths.

10.3.27 nettxlat
nettxlat(8)43 shows network device transmission latency: the time spent pushing the packet into the driver layer to enqueue it on a TX ring for the hardware to send out, until the hardware signals the kernel that packet transmission has completed (usually via NAPI) and the packet is freed. For example, from a busy production edge server:

43 Origin: I created it for this book on 21-Apr-2019.

Click here to view code image


# nettxlat.bt
Attaching 4 probes...
Tracing net device xmit queue latency. Hit Ctrl-C to end.
^C
@us:
[4, 8)              2230 |                                                    |
[8, 16)           150679 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@                        |
[16, 32)          275351 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32, 64)           59898 |@@@@@@@@@@@                                         |
[64, 128)          27597 |@@@@@                                               |
[128, 256)           276 |                                                    |
[256, 512)             9 |                                                    |
[512, 1K)              3 |                                                    |

This shows that device queued time was usually faster than 128 microseconds.

The source to nettxlat(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing net device xmit queue latency. Hit Ctrl-C to end.\n");
}

tracepoint:net:net_dev_start_xmit
{
        @start[args->skbaddr] = nsecs;
}

tracepoint:skb:consume_skb
/@start[args->skbaddr]/
{
        @us = hist((nsecs - @start[args->skbaddr]) / 1000);
        delete(@start[args->skbaddr]);
}

tracepoint:net:net_dev_queue
{
        // avoid timestamp reuse:
        delete(@start[args->skbaddr]);
}

END
{
        clear(@start);
}

This works by measuring the time from when a packet is issued to the device queue via the net:net_dev_start_xmit tracepoint, and then when that packet is freed via the skb:consume_skb tracepoint, which occurs when the device has completed sending it.

There are some edge cases where a packet may not pass through the usual skb:consume_skb path: this creates a problem as the saved timestamp may be reused by a later sk_buff, causing latency outliers to appear in the histogram. This has been avoided by deleting timestamps on net:net_dev_queue, to help eliminate their reuse.

As an example of breaking down by device name, the following lines were modified, turning nettxlat(8) into nettxlat-dev(8):

Click here to view code image


[...]
#include <linux/skbuff.h>
#include <linux/netdevice.h>
[...]
tracepoint:skb:consume_skb
/@start[args->skbaddr]/
{
        $skb = (struct sk_buff *)args->skbaddr;
        @us[$skb->dev->name] = hist((nsecs - @start[args->skbaddr]) / 1000);
[...]

The output then becomes:

Click here to view code image


# nettxlat-dev.bt
Attaching 4 probes...
Tracing net device xmit queue latency. Hit Ctrl-C to end.
^C

@us[eth0]:
[4, 8)                65 |                                                    |
[8, 16)             6438 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                      |
[16, 32)           10899 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32, 64)            2265 |@@@@@@@@@@                                          |
[64, 128)            977 |@@@@                                                |
[...]

This server only has eth0, but if other interfaces were in use, there would be a separate histogram for each.

Note that this change reduces the stability of the tool, since it is now referring to unstable struct internals instead of just tracepoints and tracepoint arguments.

10.3.28 skbdrop
skbdrop(8)44 traces unusual skb drop events, and shows their kernel stack traces along with network counters while tracing. For example, on a production server:

44 Origin: I created this tool for this book on 21-Apr-2019.

Click here to view code image


# bpftrace --unsafe skbdrop.bt
Attaching 3 probes...
Tracing unusual skb drop stacks. Hit Ctrl-C to end.
^C#kernel
IpInReceives                    28717              0.0
IpInDelivers                    28717              0.0
IpOutRequests                   32033              0.0
TcpActiveOpens                  173                0.0
TcpPassiveOpens                 278                0.0
[...]
TcpExtTCPSackMerged             1                  0.0
TcpExtTCPSackShiftFallback      5                  0.0
TcpExtTCPDeferAcceptDrop        278                0.0
TcpExtTCPRcvCoalesce            3276               0.0
TcpExtTCPAutoCorking            774                0.0
[...]

[...]
@[
    kfree_skb+118
    skb_release_data+171
    skb_release_all+36
    __kfree_skb+18
    tcp_recvmsg+1946
    inet_recvmsg+81
    sock_recvmsg+67
    SYSC_recvfrom+228
]: 50
@[
    kfree_skb+118
    sk_stream_kill_queues+77
    inet_csk_destroy_sock+89
    tcp_done+150
    tcp_time_wait+446
    tcp_fin+216
    tcp_data_queue+1401
    tcp_rcv_state_process+1501
]: 142
@[
    kfree_skb+118
    tcp_v4_rcv+361
    ip_local_deliver_finish+98
    ip_local_deliver+111
    ip_rcv_finish+297
    ip_rcv+655
    __netif_receive_skb_core+1074
    __netif_receive_skb+24
]: 276

This begins by showing network counter increments while tracing, and then stack traces for skb drops and counts for comparison. The above output shows that the most frequent drop path was via tcp_v4_rcv(), with 276 drops. The network counters show a similar count: 278 in TcpPassiveOpens and TcpExtTCPDeferAcceptDrop. (The slightly higher number can be explained: extra time is needed to fetch these counters.) This suggests that those events might be all related.

This works by instrumenting the skb:kfree_skb tracepoint, and automates running the nstat(8) tool for counting network statistics while tracing. nstat(8) must be installed for this tool to work: it is in the iproute2 package.

The skb:kfree_skb tracepoint is a counterpart of skb:consume_skb. The consume_skb tracepoint fires for the normal skb consumption code path, and kfree_skb fires for other unusual events that may be worth investigating.

The source to skbdrop(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

BEGIN
{
        printf("Tracing unusual skb drop stacks. Hit Ctrl-C to end.\n");
        system("nstat > /dev/null");
}

tracepoint:skb:kfree_skb
{
        @[kstack(8)] = count();
}

END
{
        system("nstat; nstat -rs > /dev/null");
}

This begins by setting the nstat(8) counters to zero in the BEGIN action, and then using nstat(8) again in the END action to print the interval counts, and then to reset nstat(8) back to its original state (-rs). This will interfere with other users of nstat(8) while tracing. Note that the bpftrace --unsafe option is necessary when executing this, due to the use of system().

10.3.29 skblife
skblife(8)45 measures the lifespan of a sk_buff (skb), the object used to pass packets through the kernel. Measuring the lifespan can show if there is latency within the network stack, including packets waiting for locks. For example, on a busy production server:

45 Origin: I created it for this book on 4-Apr-2019.

Click here to view code image


# skblife.bt
Attaching 6 probes...
^C

@skb_residency_nsecs:
[1K, 2K)             163 |                                                    |
[2K, 4K)             792 |@@@                                                 |
[4K, 8K)            2591 |@@@@@@@@@@                                          |
[8K, 16K)           3022 |@@@@@@@@@@@@                                        |
[16K, 32K)         12695 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32K, 64K)         11025 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@       |
[64K, 128K)         3277 |@@@@@@@@@@@@@                                       |
[128K, 256K)        2954 |@@@@@@@@@@@@                                        |
[256K, 512K)        1608 |@@@@@@                                              |
[512K, 1M)          1594 |@@@@@@                                              |
[1M, 2M)             583 |@@                                                  |
[2M, 4M)             435 |@                                                   |
[4M, 8M)             317 |@                                                   |
[8M, 16M)            104 |                                                    |
[16M, 32M)            10 |                                                    |
[32M, 64M)            12 |                                                    |
[64M, 128M)            1 |                                                    |
[128M, 256M)           1 |                                                    |

This shows that the lifespan of sk_buffs was often between 16 and 64 microseconds, however, there are outliers reaching as high as the 128 to 256 millisecond bucket. These can be further investigated with other tools, including the previously queue latency tools, to see if the latency is coming from those locations.

This works by tracing kernel slab cache allocations to find when sk_buffs are allocated and freed. Such allocations can be very frequent, and this tool may cause noticeable or significant overhead on very busy systems. It can be used for short-term analysis rather than long-term monitoring.

The source to skblife(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

kprobe:kmem_cache_alloc,
kprobe:kmem_cache_alloc_node
{
        $cache = arg0;
        if ($cache == *kaddr("skbuff_fclone_cache") ||
            $cache == *kaddr("skbuff_head_cache")) {
                @is_skb_alloc[tid] = 1;
        }
}

kretprobe:kmem_cache_alloc,
kretprobe:kmem_cache_alloc_node
/@is_skb_alloc[tid]/
{
        delete(@is_skb_alloc[tid]);
        @skb_birth[retval] = nsecs;
}

kprobe:kmem_cache_free
/@skb_birth[arg1]/
{
        @skb_residency_nsecs = hist(nsecs - @skb_birth[arg1]);
        delete(@skb_birth[arg1]);
}

END
{
        clear(@is_skb_alloc);
        clear(@skb_birth);
}

The kmem_cache_alloc() functions are instrumented, and the cache argument is matched to see if it is an sk_buff cache. If so, on the kretprobe a timestamp is associated with the sk_buff address, which is then retrieved on kmem_cache_free().

There are some caveats with this approach: sk_buffs can be segmented into other sk_buffs on GSO, or attached to others on GRO. TCP can also coalesce sk_buffs (tcp_try_coalesce()). This means that, while the lifespan of the sk_buffs can be measured, the lifespan of the full packet may be undercounted. This tool could be enhanced to take these code paths into account: copying an original birth timestamp to new sk_buffs as they are created.

Since this adds kprobe overhead to all kmem cache alloc and free calls (not just for sk_buffs), the overhead may become significant. In the future there may be a way to reduce this. The kernel already has skb:consume_skb and skb:free_skb tracepoints. If an alloc skb tracepoint was added, that could be used instead, and reduce this overhead to just the sk_buff allocations.

10.3.30 ieee80211scan
ieee80211scan(8)46 traces IEEE 802.11 WiFi scanning. For example:

46 Origin: I created this for this book on 23-Apr-2019. The first time I wrote a WiFi scanning tracer was out of necessity when I was in a hotel room in 2004 with a laptop that wouldn’t connect to the WiFi, and no error messages to say why. I came up with a similar scanner tool using DTrace, although I don’t think I published it.

Click here to view code image


# ieee80211scan.bt
Attaching 5 probes...
Tracing ieee80211 SSID scans. Hit Ctrl-C to end.
13:55:07 scan started (on-CPU PID 1146, wpa_supplicant)
13:42:11 scanning channel 2GHZ freq 2412: beacon_found 0
13:42:11 scanning channel 2GHZ freq 2412: beacon_found 0
13:42:11 scanning channel 2GHZ freq 2412: beacon_found 0
[...]
13:42:13 scanning channel 5GHZ freq 5660: beacon_found 0
13:42:14 scanning channel 5GHZ freq 5785: beacon_found 1
13:42:14 scanning channel 5GHZ freq 5785: beacon_found 1
13:42:14 scanning channel 5GHZ freq 5785: beacon_found 1
13:42:14 scanning channel 5GHZ freq 5785: beacon_found 1
13:42:14 scanning channel 5GHZ freq 5785: beacon_found 1
13:42:14 scan completed: 3205 ms

This shows a scan likely initiated by a wpa_supplicant process, which steps through various channels and frequencies. The scan took 3205 ms. This provides insight that can be useful for debugging WiFi problems.

This works by instrumenting the ieee80211 scan routines. The overhead should be negligible as these routines should be infrequent.

The source to ieee80211scan(8) is:

Click here to view code image


#!/usr/local/bin/bpftrace

#include <net/mac80211.h>

BEGIN
{
        printf("Tracing ieee80211 SSID scans. Hit Ctrl-C to end.\n");
        // from include/uapi/linux/nl80211.h:
        @band[0] = "2GHZ";
        @band[1] = "5GHZ";
        @band[2] = "60GHZ";
}

kprobe:ieee80211_request_scan
{
        time("%H:%M:%S ");
        printf("scan started (on-CPU PID %d, %s)\n", pid, comm);
        @start = nsecs;
}

kretprobe:ieee80211_get_channel
/retval/
{
        $ch = (struct ieee80211_channel *)retval;
        $band = 0xff & *retval; // $ch->band; workaround for #776
        time("%H:%M:%S ");
        printf("scanning channel %s freq %d: beacon_found %d\n",
            @band[$band], $ch->center_freq, $ch->beacon_found);
}

kprobe:ieee80211_scan_completed
/@start/
{
        time("%H:%M:%S ");
        printf("scan compeleted: %d ms\n", (nsecs - @start) / 1000000);
        delete(@start);
}

END
{
        clear(@start); clear(@band);
}

More information can be added to show the different flags and settings used while scanning. Note that this tool currently assumes that only one scan will be active at a time, and has a global @start timestamp. If scans may be active in parallel, this will need a key to associate a timestamp with each scan.

10.3.31 Other Tools
Other BPF tools worth mentioning:

solisten(8): A BCC tool to print socket listen calls with details47

47 solisten(8) was added by Jean-Tiare Le Bigot on 4-Mar-2016.

tcpstates(8): A BCC tool that prints a line of output for each TCP session state change, with IP address and port details, and duration in each state

tcpdrop(8): A BCC and bpftrace tool that prints IP address and TCP state details, and kernel stack traces, for packets dropped by the kernel tcp_drop() function

sofdsnoop(8): A BCC tool to trace file descriptors passed through Unix sockets

profile(8): Covered in Chapter 6, sampling of kernel stack traces can quantify time spent in network code paths

hardirqs(8) and softirqs(8): Covered in Chapter 6, can be used to measure the time spent in networking hard and soft interrupts

filetype(8): From Chapter 8, traces vfs_read() and vfs_write(), identifying which are socket reads and writes via the inode

Example output from tcpstates(8):

Click here to view code image


# tcpstates
SKADDR           C-PID C-COMM LADDR     LPORT  RADDR      RPORT OLDSTATE -> NEWSTATE      MS
ffff88864fd55a00 3294  record 127.0.0.1 0      127.0.0.1  28527 CLOSE    -> SYN_SENT     0.00
ffff88864fd55a00 3294  record 127.0.0.1 0      127.0.0.1  28527 SYN_SENT -> ESTABLISHED  0.08
ffff88864fd56300 3294  record 127.0.0.1 0      0.0.0.0    0     LISTEN   -> SYN_RECV     0.00
[...]

This uses the sock:inet_sock_set_state tracepoint.

10.4 BPF ONE-LINERS
These sections show BCC and bpftrace one-liners. Where possible, the same one-liner is implemented using both BCC and bpftrace.

10.4.1 BCC
Count failed socket connect(2)s by error code:

Click here to view code image

argdist -C 't:syscalls:sys_exit_connect():int:args->ret:args->ret<0'
Count socket connect(2)s by user stack trace:

Click here to view code image

stackcount -U t:syscalls:sys_enter_connect
TCP send bytes as a histogram:

Click here to view code image

argdist -H 'p::tcp_sendmsg(void *sk, void *msg, int size):int:size'
TCP receive bytes as a histogram:

Click here to view code image

argdist -H 'r::tcp_recvmsg():int:$retval:$retval>0'
Count all TCP functions (adds high overhead to TCP):

Click here to view code image

funccount 'tcp_*'
UDP send bytes as a histogram:

Click here to view code image

argdist -H 'p::udp_sendmsg(void *sk, void *msg, int size):int:size'
UDP receive bytes as a histogram:

Click here to view code image

argdist -H 'r::udp_recvmsg():int:$retval:$retval>0'
Count all UDP functions (adds high overhead to UDP):

Click here to view code image

funccount 'udp_*'
Count transmit stack traces:

Click here to view code image

stackcount t:net:net_dev_xmit
Count ieee80211 layer functions (adds high overhead to packets):

Click here to view code image

funccount 'ieee80211_*'
Count all ixgbevf device driver functions (adds high overhead to ixgbevf):

Click here to view code image

funccount 'ixgbevf_*'
10.4.2 bpftrace
Count socket accept(2)s by PID and process name:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_accept* { @[pid, comm] = count(); }'
Count socket connect(2)s by PID and process name:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_connect { @[pid, comm] = count(); }'
Count failed socket connect(2)s by process name and error code:

Click here to view code image

bpftrace -e 't:syscalls:sys_exit_connect /args->ret < 0/ { @[comm, - args->ret] =
    count(); }'
Count socket connect(2)s by user stack trace:

Click here to view code image

bpftrace -e 't:syscalls:sys_enter_connect { @[ustack] = count(); }'
Count socket send/receives by direction, on-CPU PID, and process name48:

48 The earlier socket syscalls are in process context, where PID and comm are reliable. These kprobes are deeper in the kernel, and the process endpoint for these connections my not be currently on-CPU, meaning the pid and comm shown by bpftrace could be unrelated. They usually work, but that may not always be the case.

Click here to view code image

bpftrace -e 'k:sock_sendmsg,k:sock_recvmsg { @[func, pid, comm] = count(); }'
Count socket send/receive bytes by on-CPU PID and process name:

Click here to view code image

bpftrace -e 'kr:sock_sendmsg,kr:sock_recvmsg /(int32)retval > 0/ { @[pid, comm] =
    sum((int32)retval); }'
Count TCP connects by on-CPU PID and process name:

Click here to view code image

bpftrace -e 'k:tcp_v*_connect { @[pid, comm] = count(); }'
Count TCP accepts by on-CPU PID and process name:

Click here to view code image

bpftrace -e 'k:inet_csk_accept { @[pid, comm] = count(); }'
Count TCP send/receives:

Click here to view code image

bpftrace -e 'k:tcp_sendmsg,k:tcp*recvmsg { @[func] = count(); }'
Count TCP send/receives by on-CPU PID and process name:

Click here to view code image

bpftrace -e 'k:tcp_sendmsg,k:tcp_recvmsg { @[func, pid, comm] = count(); }'
TCP send bytes as a histogram:

Click here to view code image

bpftrace -e 'k:tcp_sendmsg { @send_bytes = hist(arg2); }'
TCP receive bytes as a histogram:

Click here to view code image

bpftrace -e 'kr:tcp_recvmsg /retval >= 0/ { @recv_bytes = hist(retval); }'
Count TCP retransmits by type and remote host (assumes IPv4):

Click here to view code image

bpftrace -e 't:tcp:tcp_retransmit_* { @[probe, ntop(2, args->saddr)] = count(); }'
Count all TCP functions (adds high overhead to TCP):

Click here to view code image

bpftrace -e 'k:tcp_* { @[func] = count(); }'
Count UDP send/receives by on-CPU PID and process name:

Click here to view code image

bpftrace -e 'k:udp*_sendmsg,k:udp*_recvmsg { @[func, pid, comm] = count(); }'
UDP send bytes as a histogram:

Click here to view code image

bpftrace -e 'k:udp_sendmsg { @send_bytes = hist(arg2); }'
UDP receive bytes as a histogram:

Click here to view code image

bpftrace -e 'kr:udp_recvmsg /retval >= 0/ { @recv_bytes = hist(retval); }'
Count all UDP functions (adds high overhead to UDP):

Click here to view code image

bpftrace -e 'k:udp_* { @[func] = count(); }'
Count transmit kernel stack traces:

Click here to view code image

bpftrace -e 't:net:net_dev_xmit { @[kstack] = count(); }'
Show receive CPU histogram for each device:

Click here to view code image

bpftrace -e 't:net:netif_receive_skb { @[str(args->name)] = lhist(cpu, 0, 128, 1); }'
Count ieee80211 layer functions (adds high overhead to packets):

Click here to view code image

bpftrace -e 'k:ieee80211_* { @[func] = count()'
Count all ixgbevf device driver functions (adds high overhead to ixgbevf):

Click here to view code image

bpftrace -e 'k:ixgbevf_* { @[func] = count(); }'
Count all iwl device driver tracepoints (adds high overhead to iwl):

Click here to view code image

bpftrace -e 't:iwlwifi:*,t:iwlwifi_io:* { @[probe] = count(); }'
10.4.3 BPF One-Liners Examples
Including some sample output, as was done for each tool, is also useful for illustrating one-liners.

Counting Transmit Kernel Stack Traces
Click here to view code image


# bpftrace -e 't:net:net_dev_xmit { @[kstack] = count(); }'
Attaching 1 probe...
^C
[...]

@[
    dev_hard_start_xmit+945
    sch_direct_xmit+882
    __qdisc_run+1271
    __dev_queue_xmit+3351
    dev_queue_xmit+16
    ip_finish_output2+3035
    ip_finish_output+1724
    ip_output+444
    ip_local_out+117
    __ip_queue_xmit+2004
    ip_queue_xmit+69
    __tcp_transmit_skb+6570
    tcp_write_xmit+2123
    __tcp_push_pending_frames+145
    tcp_rcv_established+2573
    tcp_v4_do_rcv+671
    tcp_v4_rcv+10624
    ip_protocol_deliver_rcu+185
    ip_local_deliver_finish+386
    ip_local_deliver+435
    ip_rcv_finish+342
    ip_rcv+212
    __netif_receive_skb_one_core+308
    __netif_receive_skb+36
    netif_receive_skb_internal+168
    napi_gro_receive+953
    ena_io_poll+8375
    net_rx_action+1750
    __do_softirq+558
    irq_exit+348
    do_IRQ+232
    ret_from_intr+0
    native_safe_halt+6
    default_idle+146
    arch_cpu_idle+21
    default_idle_call+59
    do_idle+809
    cpu_startup_entry+29
    start_secondary+1228
    secondary_startup_64+164
]: 902
@[
    dev_hard_start_xmit+945
    sch_direct_xmit+882
    __qdisc_run+1271
    __dev_queue_xmit+3351
    dev_queue_xmit+16
    ip_finish_output2+3035
    ip_finish_output+1724
    ip_output+444
    ip_local_out+117
    __ip_queue_xmit+2004
    ip_queue_xmit+69
    __tcp_transmit_skb+6570
    tcp_write_xmit+2123
    __tcp_push_pending_frames+145
    tcp_push+1209
    tcp_sendmsg_locked+9315
    tcp_sendmsg+44
    inet_sendmsg+278
    sock_sendmsg+188
    sock_write_iter+740
    __vfs_write+1694
    vfs_write+341
    ksys_write+247
    __x64_sys_write+115
    do_syscall_64+339
    entry_SYSCALL_64_after_hwframe+68
]: 10933

This one-liner produced many pages of output; only the last two stack traces have been included here. The last shows a write(2) syscall passing through VFS, sockets, TCP, IP, net device, and then beginning the transmit to the driver. This illustrates the stack from the application to the device driver.

The first stack trace is even more interesting. It begins with the idle thread receiving an interrupt, running the net_rx_action() softirq, the ena driver ena_io_poll(), the NAPI (new API) network interface receive path, then IP, tcp_rcv_established(), and then...__tcp_push_pending_frames(). The real code path is tcp_rcv_established() -> tcp_data_snd_check() -> tcp_push_pending_frames() -> tcp_push_pending_frames(). However, the middle two functions were tiny and inlined by the compiler, eliding them from that stack trace. What’s happening is that TCP is checking for pending transmits during the receive codepath.

Counting All ixgbevf Device Driver Functions (Adding High Overhead to ixgbevf)
Click here to view code image


# bpftrace -e 'k:ixgbevf_* { @[func] = count(); }'
Attaching 116 probes...
^C

@[ixgbevf_get_link_ksettings]: 2
@[ixgbevf_get_stats]: 2
@[ixgbevf_obtain_mbx_lock_vf]: 2
@[ixgbevf_read_mbx_vf]: 2
@[ixgbevf_service_event_schedule]: 3
@[ixgbevf_service_task]: 3
@[ixgbevf_service_timer]: 3
@[ixgbevf_check_for_bit_vf]: 5
@[ixgbevf_check_for_rst_vf]: 5
@[ixgbevf_check_mac_link_vf]: 5
@[ixgbevf_update_stats]: 5
@[ixgbevf_read_reg]: 21
@[ixgbevf_alloc_rx_buffers]: 36843
@[ixgbevf_features_check]: 37842
@[ixgbevf_xmit_frame]: 37842
@[ixgbevf_msix_clean_rings]: 66417
@[ixgbevf_poll]: 67013
@[ixgbevf_maybe_stop_tx]: 75684
@[ixgbevf_update_itr.isra.39]: 132834

The internals of how network device drivers operate can be studied in detail using these kprobes. Don’t forget to check whether the driver supports tracepoints as well, as shown in the next example.

Counting All iwl Device Driver Tracepoints (Adding High Overhead to iwl)
Click here to view code image


# bpftrace -e 't:iwlwifi:*,t:iwlwifi_io:* { @[probe] = count(); }'
Attaching 15 probes...
^C

@[tracepoint:iwlwifi:iwlwifi_dev_hcmd]: 39
@[tracepoint:iwlwifi_io:iwlwifi_dev_irq]: 3474
@[tracepoint:iwlwifi:iwlwifi_dev_tx]: 5125
@[tracepoint:iwlwifi_io:iwlwifi_dev_iowrite8]: 6654
@[tracepoint:iwlwifi_io:iwlwifi_dev_ict_read]: 7095
@[tracepoint:iwlwifi:iwlwifi_dev_rx]: 7493
@[tracepoint:iwlwifi_io:iwlwifi_dev_iowrite32]: 19525

This one-liner is showing only two of several groups of iwl tracepoints.

10.5 OPTIONAL EXERCISES
If not specified, these can be completed using either bpftrace or BCC:

Write an solife(8) tool to print per-session durations from connect(2) and accept(2) (and variants) to close(2) for that socket file descriptor. It can be similar to tcplife(8), although it does not necessarily need all the same fields (some are harder to fetch than others).

Write tcpbind(8): a tool for per-event tracing of TCP bind events.

Extend tcpwin.bt with a "retrans" event type, with the socket address and time as fields.

Extend tcpwin.bt with a "new" event type, that has socket address, time, IP addresses, and TCP ports as fields. This should be printed when the TCP session reaches the established state.

Modify tcplife(8) to emit connection details in DOT format, then plot using graphing software (e.g., GraphViz).

Develop udplife(8) to show the lifespan of UDP connections, similar to tcplife(8).

Extend ipecn.bt to instrument outbound CE events, as well as IPv6. CE events can be introduced at the qdisc layer using the netem qdisc. The following example command replaces the current qdisc on eth0 with one that causes 1% ECN CE events:

Click here to view code image

tc qdisc replace dev eth0 root netem loss 1% ecn
If you use this qdisc during development, be aware that it inserts CE events at a lower level than IP. If you traced, say, ip_output(), you may not see the CE events as they are added later.

(Advanced) Develop a tool to show TCP round-trip time by host. This could show either an average RTT by host, or a RTT histogram by host. The tool could time sent packets by sequence number and associate the timestamp on the ACK, or make use of struct tcp_sock->rtt_min, or another approach. If the first approach is used, the TCP header can be read, given a struct sk_buff * in $skb as (using bpftrace):

Click here to view code image

$tcph = (struct tcphdr *)($skb->head + $skb->transport_header);
(Advanced, unsolved) Develop a tool to show ARP or IPv6 neighbor discovery latency, either per-event or as a histogram.

(Advanced, unsolved) Develop a tool that shows the full sk_buff lifespan, dealing (when or if necessary) with GRO, GSO, tcp_try_coalesce(), skb_split(), skb_append(), skb_insert(), etc, and other events that modify an sk_buff during its lifespan. This tool will become much more complex than skblife(8).

(Advanced, unsolved) Develop a tool that breaks down the sk_buff lifespan (from (9)) into components or wait states.

(Advanced, unsolved) Develop a tool to show latency caused by TCP pacing.

(Advanced, unsolved) Develop a tool to show byte queue limit latency.

10.6 SUMMARY
This chapter summarizes characteristics of the Linux network stack, and their analysis with traditional tools: netstat(8), sar(1), ss(8), and tcpdump(8). BPF tools were then used to provide extended observability of the socket layer, TCP, UDP, ICMP, qdiscs, net driver queues, and then a network device driver. This observability included showing new connections efficiently and their lifespans, connection and first byte latency, SYN backlog queue size, TCP retransmits, and various other events.

CopyAdd HighlightAdd Note
back to top
