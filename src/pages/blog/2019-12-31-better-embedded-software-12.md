---
templateKey: blog-post
title: Better embedded software ch12 notes 
date: 2019-12-31T00:00:00.000Z
description: study note
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - better embedded
---
Chapter 12 軟體設計
===
###### tags: `mutex`, `concurrency`, `better-embedded`
> 這裡是對CMU的Philip Koopman教授的著作 [Better Embedded System Software](https://www.amazon.com/Better-Embedded-System-Software-Koopman/dp/0984449000) 20章 做的翻譯練習。
重點提示
* 軟體設計藉由總攬全局的上層表示在不給出每一行的規範前提下？？？？
* 常見的設計呈現方式有： pseudo code, 流程圖 flowchart, 狀態圖 statecharts。
* 比起跳過設計階段直接開始寫 code, 先寫出一份軟體設計有助於整理思緒及更有效的找出可能問題。
* Model-based design 可以讓我們在設計層級上作業並透過 synthesis 工具自動產出實作的程式碼？？？

章節內容：
12.1 章節總覽
12.2 設計扮演的角色
設計裡不應包含任何形式的實作及程式碼
12.3 不同的設計呈現方式
每個設計圖表都應該是一張紙的大小。流程圖適合用來模組之間控制權的流動最重要的時候。狀態圖則是適合系統行為是基於 modal 或是有限狀態機。 Model-based 設計工具只適合在該種 model 適合的情況下？？？
12.4 坑/pitfall: 以註解代替設計
註解!=設計
12.5 更多資訊