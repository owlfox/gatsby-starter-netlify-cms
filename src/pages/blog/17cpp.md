---
templateKey: blog-post
title: 17cpp, 一起C++
date: 2030-01-01T00:00:00.000Z
description: My list of c++ system programming notes
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
In mandarin， 1(yi)7(qi) sounds similiar to together,  lets do c++ together！！
此系列文章跟 17 公司沒有任何關係，單純紀錄學習 C++17 XD 

* 我的背景
1. 曾經維護過有點古老，基於 ACE framework + MFC 的 C++ 網路程式。(那時候真的不知道自己在幹麻)
2. 學了一點 C 語言（從 jserv 的線上/下課程），了解基礎的 Linux 系統及網路管理。
3. 讀過 CSAPP 3e，大概知道 C 語言與 X86_64, system programming 的距離。



* 預期目標
1. 了解 C++17 的關鍵字，以及稱不上現代/modern 但是符合這個時代的 C++ 開發工具、慣例。
2. 主要目標是讓自己成為更好的 Linux system programmer, 並幫助未來失憶的自己、或是其他人。

# 目錄
## Basics
* C++ 是在哈囉 with conan, cmake, catch2
* Declaration, Definition, headers, implementations
* Statement expression, if, for, switch, try/catch
* integer, floating number, built-in array
* API, header, implementation
* const, static, explicit function, &&?
* different ways of casting
* const correctness, [C](https://stackoverflow.com/questions/21476869/constant-pointer-vs-pointer-to-constant/21476937)
 
## 物件，不是買房子的那個物件。
* class, struct, some patterns
* RAII, unique/shared/weak_ptr, std::move, ownership?
* Explicit implicit
* ways of initialization
* virtual
* auto
* noexcept

## template

## 物件道
* singleton
* forward declartion
* preprocessor directives


# 演算法
* trees(3 orders) + RAII + smart_ptr
* stack/queue
* graph

## 好用工具
* catch2
* boost
* poco

## 管理/CI
* conan



# C++ 學習資源 /  參考資料
* 文章架構想參考[良葛格](https://openhome.cc/Gossip/CppGossip/index.html)的方法, 慢慢把個別主題的資訊整理出來。
cppcast
cppconf
* https://thispointer.com/shared_ptr-binary-trees-and-the-problem-of-cyclic-references/

## C++
* A tour of C++ 2e
* Hands-on system programming with C++
* 
## system programming

## Data structure / algorithm

