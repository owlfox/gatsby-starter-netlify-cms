---
templateKey: blog-post
title: Linux system programming notes
date: 2020-01-07T00:00:00.000Z
description: Linux system programming
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - system programming
  - linux
---

# C++ 與 linux 系統程式開發
* 作業系統管理硬體資源並提供程式執行環境，我們將以 linux 作為主要的系統程式開發平台。 linux 作為自由軟體界的作業系統代表，在個人電腦、伺服器都有有廣泛應用。
* 作業系統支援 不同的硬體架構，例如 x86-64, arm, 等不同處理器架構，並提供相同的程式開發介面 API 讓開發人員透過呼叫 system call 跟系統互動。

## ABI application binary interface 
為不同作業系統間規範執行檔如何包裝及呼叫 system call 
以 BIOS 為例子，我們只要在暫存器放入不同資料，並呼叫特定指令即可與硬碟進行互動，不管理底層硬碟、其他同步運行的程式細節。BIOS 將會中斷程式運行，並取得硬碟資料後將控制權交還給當前程式。 中斷處理時的記憶體、暫存器資料拜訪規範即為 ABI。


## 常見的 system call， POSIX comliant
* console IO
作業系統負責管理終端機顯示及輸入的內容，我們只需要透過呼叫 printf(c), std::cout(c++) 等即可開發終端機程式，也可以告訴作業系統將輸出導入到檔案或是其他硬體介面。

* 記憶體管理
當我們需要更多記憶體空間來執行程式，作業系統居中管理可用及其他程式使用的記憶體。 malloc, free

* 檔案 io
可對 檔案、 character, block, 甚至虛擬裝置(/dev/random) 做讀寫

* 網路

* 時間

* thread 及 process 


## C/C++
what is C standard
* C++ 17
what is C library
* threading support from pthread



## RAII
## GSL

# vim 
array[0] = 0;
array[0] = 0;
array[0] = 0;
array[0] = 0;
array[0] = 0;

## kernel development?
https://github.com/cirosantilli/linux-kernel-module-cheat/tree/82fab09e1ec0e9b1931eba81f2974b8c8c7b41b9#9p

