---
templateKey: blog-post
title: notes of C++17
date: 2020-01-07T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
因為最近的一個面試需要，開始重新學習 C++，上次若有似無的學習應該是 2014 年的時候了。那個時候 C++11才剛出現不久，馬上就到了 C++17, 20 的世代了呢。對這個語言的印象一直是過於複雜加之有 C 可寫底層硬體軟體的彈性，難以駕馭。或許也是因為如此，之前在 debian conf 上聽到的工作機會多是 C++ 有關，再加上一份感興趣的工作，應該足夠作為我驅使自己學習 C++ 的動機了吧！

希望這幾天可以涵蓋到以下內容：
* Tour of c++, all
* cmake, catch2, boost
* tmux + vim + relevant plugins
* hackerrank 練手感
然後下次面試表現得好一些！
* 了解一下系統開發重點- better embedded system software
* 想做這份工作的動機




# basics
## ways to iterate
* all_of
* range_for
* iterator
* c style for

# struct/class
## struct
跟 C 差不多
## class
提供更複雜的物件封裝
* private/public

## unique_, shared_, weak_, null_ptr


## new, delete

## copy, move, ... etc
=delete, delete the init way provided
class A {
  public:
  A(const A&) =delete;
  A& operator=(const A&) =delete;
}
=default,
=0, pure virtual, interfaces to be implemented

explicit for type conversion, initilization

# 編譯加測試
## catch2 + cmake

# C++17
## better auto

# lib
## boost
`apt install libboost-all-dev`
```
#include <initializer_list>
auto intValues = {1, 2, 3};
auto doubleValues = {1.1, 2.2, 3.3};
```



## nested namespace

# ref
1. tour of c++
2. c++ a crash course
3. Getting started with C++17

