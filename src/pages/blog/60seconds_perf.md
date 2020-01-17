---
templateKey: blog-post
title: notes of ch3 60 秒快速找出系統效能問題 <BPF Performance Tools> 
date: 2020-01-07T00:00:00.000Z
description: notes of chapter 3
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - ebpf
---

# why

當我們需要處理以下議題：
* Latency, 系統延遲,等候時間, msec
* Rate, 操作/請求頻率, req/sec
* Throughput, 頻寬, bit(byte)s/s
* Utilization, 時間內資源忙碌程度, %
* Cost, 價格/效能比
他們可能源自：等候系統資源（網路、硬碟、同步鎖）、CPU 運算速度、OS 排程, ...

如何快速找出系統效能瓶頸、評估問題所在、降低營運成本？
ebpf(bcc, bpftrace) 可以如何協助我們完成這些事？
> 安裝 bpftrace 方法請看 [readme](https://github.com/iovisor/bpftrace/blob/master/INSTALL.md#ubuntu-packages)
# How
## 辨別負載特性的流程
1. 誰造成的？ pid, process name, UID, IP address
2. 為什麼會有這負載? 程式路徑、 stack trace, flame graph
3. 負載量？ IOPS, throughput, type
4. 負載隨時間的變化？ 區段時間內的變化

例如以下 bpf 工具指令, 
```
# vfsstat
or
$ sudo bpftrace -e 'kprobe:vfs_read { @[comm] = count(); }'
```

可觀察時間內 vfs_read 的呼叫次數, process name...
> [(vfsstat source)](https://github.com/iovisor/bcc/blob/master/tools/vfsstat.py)

這裡主要紀錄一下作者提及的系統效能評估方法，及 bpf 的替代方案及其優點

## Drill-Down Ayalysis
1. 從最上層的系統行為開始
2. 檢驗下一階的細節
3. 找出有趣的現象、線索
4. 如果沒解決 goto 2.

例如：
1. latency 100ms
2. 10 ms on cpu, 90 ms blocked
3. 89 ms 在等檔案系統
4. ... 找到問題是在等待檔案系統回應

也可以繼續往下挖
1. 89 ms fs
2. 78 ms on writes, 11ms on reads
3. 找到 77ms 花在存取時間戳上

## USE 分析法
1. Utilization
2. Saturation
3. Errors
畫出系統 bus, 子系統架構圖、檢驗對於每個子系統你是否都有工具可以找出 USE 來。

## 檢查表 / checklist
作者與 Netflix 效能團隊用來檢驗效能低落系統的流程/ 60 sec analysis:：

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

```
$ uptime
 03:16:59 up 17 days,  4:18,  1 user,  load average: 2.74, 2.54, 2.58
```
> from man uptime: System load averages is the average number of processes that are either in a runnable or uninterruptable state.
三個數字 1, 5, 15 分鐘內的系統負載。

```
$ dmesg | tail
[1880957.563150] perl invoked oom-killer: gfp_mask=0x280da, order=0, oom_score_adj=0
[...]
[1880957.563400] Out of memory: Kill process 18694 (perl) score 246 or sacrifice child
[1880957.563408] Killed process 18694 (perl) total-vm:1972392kB, anon-rss:1953348kB, file-rss:0kB
[2320864.954447] TCP: Possible SYN flooding on port 7001. Dropping request.  Check SNMP counters.
```
可以看到最近發生的系統錯誤訊息（OOM, TCP drop, ...)
```
$ vmstat 1
procs ---------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
34  0    0 200889792  73708 591828    0    0     0     5    6   10 96  1  3  0  0
32  0    0 200889920  73708 591860    0    0     0   592 13284 4282 98  1  1  0  0
32  0    0 200890112  73708 591860    0    0     0     0 9501 2154 99  1  0  0  0
[...]
```
源自 bsd 的虛擬記憶體用量統計工具， 1 代表每秒的 summary
r: 運行、等待中的 process 數量
free: 可用的記憶體 KB
si, so: swap-in, swap-out: 有使用 swap 的時候才有用, 如果非 0 代表記憶體用完了
us, sy, id, wa, st: CPU 時間 大部分解： user time, system time, idle, wait I/O, stolen time

```
$ mpstat -P ALL 1
[...]
03:16:41 AM  CPU   %usr  %nice  %sys %iowait  %irq  %soft %steal %guest %gnice  %idle
03:16:42 AM  all  14.27   0.00  0.75    0.44  0.00   0.00   0.06   0.00   0.00  84.48
03:16:42 AM    0 100.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00   0.00
03:16:42 AM    1   0.00   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00 100.00
03:16:42 AM    2   8.08   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  91.92
03:16:42 AM    3  10.00   0.00  1.00    0.00  0.00   0.00   1.00   0.00   0.00  88.00
03:16:42 AM    4   1.01   0.00  0.00    0.00  0.00   0.00   0.00   0.00   0.00  98.99
```
%100 user time -> 單執行緒 效能瓶頸
%iowait -> 用硬碟工具分析
%sys -> 用 syscall, kernel tracing, cpu profiing 工具分析

```
$ pidstat 1
Linux 4.13.0-19-generic (...)         08/04/2018    _x86_64_       (16 CPU)

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
各 process 的 cpu 用量, 400% 代表用滿四個 CPU
```
$ iostat -xz 1
Linux 4.13.0-19-generic (...)         08/04/2018    _x86_64_      (16 CPU)
[...]
avg-cpu:  %user   %nice %system %iowait  %steal   %idle
         22.90    0.00    0.82    0.63    0.06   75.59

Device:         rrqm/s   wrqm/s     r/s     w/s    rkB/s     wkB/s avgrq-sz avgqu-sz await r_await w_await  svctm  %util
nvme0n1           0.00  1167.00    0.00 1220.00     0.00 151293.00   248.02     2.10  1.72    0.00    1.72   0.21  26.00
nvme1n1           0.00  1164.00    0.00 1219.00     0.00 151384.00   248.37     0.90  0.74    0.00    0.74   0.19  23.60
md0               0.00     0.00    0.00 4770.00     0.00 303113.00   127.09     0.00  0.00    0.00    0.00   0.00   0.00
[...]
```
各儲存裝置 I/O 指數，每秒更新
r/s, w/s, rkB/s, wkB/s: 完成的讀寫次數及資料量
await: 平均 I/O完成時間 msec, 包含儲列中等待及實際處理事件，數值過大代表裝置太忙或是有問題
avgqu-sz: 該裝置時間內的平均請求次數，大於一代表太忙，不過後面有很多實體裝置的虛擬裝置可能會平行處理、出現大於一
%util: 每秒該裝置在忙碌/工作的時間比例，大於 60% 通常就是效能瓶頸

```
$ free -m
              total        used        free      shared  buff/cache   available
Mem:         122872       39158        3107        1166       80607       81214
Swap:             0           0           0
```
顯示可用的實體記憶體 MB

```
$ sar -n DEV 1
Linux 4.13.0-19-generic (...)     08/04/2018    _x86_64_      (16 CPU)

03:38:28 AM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s  rxmcst/s   %ifutil
03:38:29 AM      eth0   7770.00   4444.00  10720.12   5574.74      0.00      0.00      0.00      0.00
03:38:29 AM        lo     24.00     24.00     19.63     19.63      0.00      0.00      0.00      0.00

03:38:29 AM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s  rxmcst/s   %ifutil
03:38:30 AM      eth0   5579.00   2175.00   7829.20   2626.93      0.00      0.00      0.00      0.00
03:38:30 AM        lo     33.00     33.00      1.79      1.79      0.00      0.00      0.00      0.00
[...]
```
這指令用來看網路介面使用是否到達上限

```
# sar -n TCP,ETCP 1
Linux 4.13.0-19-generic (...)     08/04/2019    _x86_64_      (16 CPU)

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
 active/s: Number of locally-initiated TCP connections per second (e.g., via connect()).

• passive/s: Number of remotely-initiated TCP connections per second (e.g., via accept()).

• retrans/s: Number of TCP retransmits per second.
```
top - 03:44:14 up 17 days,  4:46,  1 user,  load average: 2.32, 2.20, 2.21
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

# ref
1. http://www.brendangregg.com/ebpf.html
2. [Brendan Gregg, BPF Performance Tools](http://www.brendangregg.com/bpf-performance-tools-book.html)
3. http://www.brendangregg.com/ebpf.html#frontends
4. 