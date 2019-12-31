---
templateKey: blog-post
title: Better embedded software ch20 notes 
date: 2019-12-23T00:00:00.000Z
description: study note
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - embedded
---
Chapter 20 Mutexes and Data Access Concurrency
===
###### tags: `mutex`, `concurrency`, `better-embedded`
> 這裡是對CMU的Philip Koopman教授的著作 [Better Embedded System Software](https://www.amazon.com/Better-Embedded-System-Software-Koopman/dp/0984449000) 20章 做的翻譯練習。
重點提示
* 各 tasks 共享的變數必須要有保護並行(concurrency)操作的機制來避免臭蟲/bug。
* 常見的危險動作是 multi-byte 的資料在讀取過程中被更新、硬體暫存器在讀取中被改及對一個數值同時進行多個寫入操作。
* 介紹 volatile 關鍵字、 透過 interrupt masking 進行 atomic 修改、 data queue 及 mutex（互斥鎖）等並行作業處理機制。
* 要讓一段程式在多執行緒情況下 reentrant，必須進行的額外處置。

章節內容：
* 20.1 章節概要
* 20.2 資料共享之危險因素 / hazard
資料讀取中被修改或是多個寫入作業對同資料做操作都是危險動作。另外也要小心處理 multi-byte timer 數值 rollover/反轉的情況。
* 20.3 資料保護策略
所有被多項作業 task (包含 ISR ) 共享的資料結構都必須加上可行最輕量的並行保護（concurrency protection）。常見保護機制有：volatile(C/C++), 藉由 masking 中斷實作的 atomic 修改、queue、 double buffering, mutex
* 20.4 Reentrant 的程式
只用動態 allocated 的資源、讓你的程式碼能讓多個作業單元同步運行。
* 20.5 坑/pitfall
* 20.6 更多資訊
也可參考 14 章 Real time / 實時系統, 19 章 邪惡的全域變數

# 20.1 前言
定義 concurrent/並行:  
並行者，當兩項作業/操作在任何時間點同為 "active" 狀態即為之。
> 即便該其一處在 暫停 / suspended 的狀態，而只有其一在運行也算。任何 B 開始作業之後 A 還沒完成他的工作的作業都算 concurrent.
並行對嵌入式系統來說很常見，該系統可能一邊無盡的執行控制演算法而同時系統還是保持在正常運行狀態，絕大多數的嵌入式系統某種程度上來說都會面臨並行議題。

當一筆資料或是記憶體位址在任一時間點被一嵌入式系統裡的不同作業/task共享時，問題就有可能發生。簡單來說，問題發生在於其一 task 誤以為其他 task 不會動該筆資料。換句話說，並行問題發生在兩個 task 在同一個資源/資料的使用上無法共事。特常見的案例是當 ISR 改了一個正在存取某共用資料的主要程序陣亡。因而我們必須確保資料在會被其他 task/硬體 修改的情況下，取得/寫入正確的資料。
一般我們有兩種解法，一是上鎖或是保護該資料在不會導致系統行為異常的前提下才能被讀取、修改。其二是使用不容易受到並行問題影響的機制來做 作業/task 同步，如 queue, 讓共用的程式碼變得 reentrant。

20.1.1 使用並行資料處理技巧的重要性
絕大多數的嵌入式系統都有並行問題。只要你開始有多個 task 從軟體系統的不同模組存取同一資料、或是使用中斷處理，你就是並行問題的高風險群。
找出一個系統是否有並行臭蟲很難，因為症狀發生取決於特定時間點不同子系統的狀態。開發期就積極並鉅細靡遺的找出並行問題非常非常重要。當你在測試或是部署階段才來做，找出問題的難度及修正的成本都會非常高。

20.1.2 可能症狀

# 20.4 Reentrant code
當我們可以同時

# 20.5 坑
最容易包的地方是一開始就對並行作業不尊重。並行處理要做得好是很不容易的，很容易自我感覺良好用了特定的輕量並行機制而曲解了規定。此類案件，大多數當事人都會爆炸。更慘的是你有可能是在開發完成進行一系列測試的時候才發現問題，或是已經出貨了才發現。假如你不是個並行專家，建議還是用驗證過的手法來實作。即便你真的是個專家，作者建議你還是應該乖乖用驗證過的工具。

# 20.6 更多資訊：
20.6.1 關鍵字
* data queue
* mutex
* semaphore
* reentrant code
* thread safe

20.6.2 建議閱讀
* Gannsle j. "Reentrancy" embedded system programming april 2001 pp183-184
寫 reentrant code 的簡介
* Beatty, S., "Where testing fails" embedded system programming August 2003 pp36-41
從測試及除錯的觀點討論並行議題