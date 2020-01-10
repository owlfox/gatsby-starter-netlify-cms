---
templateKey: blog-post
title: 60 秒快速找出系統效能問題 <BPF Performance Tools> 
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
ebpf 可以如何協助我們完成這些事？

# 

這裡主要紀錄一下作者提及的系統效能評估方法，及 bpf 的替代方案及其優點


# ref
1. http://www.brendangregg.com/ebpf.html
2. [Brendan Gregg, BPF Performance Tools](http://www.brendangregg.com/bpf-performance-tools-book.html)
3. http://www.brendangregg.com/ebpf.html#frontends