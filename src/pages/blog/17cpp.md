---
templateKey: blog-post
title: notes of C++17
date: 2020-01-01T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
# WIP
這篇文有點放太多東西了，我打算參考良葛格的方法慢慢把個別主題的資訊拆分開來。
# 17cpp
In mandarin， 1(yi)7(qi) sounds similiar to together,  lets do c++ together！！

因為最近的一個面試需要，開始重新學習 C++，上次若有似無的學習應該是 2014 年的時候了。那個時候 C++11才剛出現不久，馬上就到了 C++17, 20 的世代了呢。對這個語言的印象一直是過於複雜加之有 C 可寫底層硬體軟體的彈性，難以駕馭。或許也是因為如此，之前在 debian conf 上聽到的工作機會多是 C++ 有關，再加上這份感興趣的工作，應該足夠作為我驅使自己學習 C++ 的動機了吧！

希望這幾天可以涵蓋到以下內容：
* C
* Tour of c++, all
* cmake, catch2, boost
* tmux + vim + relevant plugins
* hackerrank/leetcode/codewars/codingame/寫遊戲 練手感
* 了解一下系統開發重點- better embedded system software
* wasm 跟 遊戲開發

# C
我覺得還是要先了解 C 才能體會到 C++ 加了哪些方便的工具，幫你做掉哪些工作跟最重要的 C 與 Assembly 的距離。這個另外寫一篇 CSAPP 的心得好了。

# 基本語法
# 函式庫
## string
## vector
## qeueu， dequeue

# cpp best practices
* 正確姿勢： Cpp core [guidelines](https://github.com/isocpp/CppCoreGuidelines/blob/master/CppCoreGuidelines.md)
* unit testing with header only lib [catch2](https://github.com/catchorg/Catch2/blob/master/docs/assertions.md)
* setup env with conan?

## c++ good at
1. energy efficient, good response time
2. a lot of features.. generic code to bit manupluation
3. user defined types <-> classes(from simula) to allow you build on your own types/abstractions.

# memory
`void*` 此類指針只代表指向一塊記憶體/object，沒 type 資訊無法對其操作。 有 type 的就可以操作存取之類的。


# basics
* pass by value ? reference ?

## ways to iterate
* all_of
* range_for
* iterator
* c style for

# algorithm
## max of a vector with lambda, [ref](http://www.cplusplus.com/reference/algorithm/max_element/)
```
#include <algorighm>
#include <vector>
int max_of_four(int a, int b, int c, int d) {
    vector<int> nums{a,b,c,d};
    return *max_element(nums.begin(), nums.end(), [](auto i, auto j) {return i<j;});
}
```


# struct/class, resource management
## struct
跟 C 差不多，可以封裝 function call
## class
提供更複雜的物件封裝
* private/public
* static/explicit/friend
* move forward
* && [Rvalue ref](https://stackoverflow.com/questions/4549151/c-double-address-operator)

## unique_, shared_, weak_, null_ptr

## RAII
A standard idiom for handling allocation and allocation failure in C++ is Resource Acquisition Is Initialization (RAII). RAII is a simple technique that harnesses C++’s notion of object lifetime to control program resources such as memory, file handles, network connections, audit trails, and so forth. To keep track of a resource, create an object and associate the resource’s lifetime with the object’s lifetime. This allows you to use C++’s object-management facilities to manage resources. In its simplest form, an object is created whose constructor acquires a resource and whose destructor frees the resource [Dewhurst 2005]. 
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
安裝 `apt install libboost-all-dev`

## stl, template
```
#include <initializer_list>
auto intValues = {1, 2, 3};
auto doubleValues = {1.1, 2.2, 3.3};
```

## math

## concurrency
* async,future
* tbb
* mpi


## nested namespace

#  Object serialization


# wasm
···
  int main() {
       printf("Hello World\n");
       EM_ASM( InitWrappers() );
       printf("Initialization Complete\n");
}
···
EM_ASM 呼叫 js InitWrappers() 做 js 與 wasm 的 function binding
> 也可以透過呼叫 postrun 來做這件事

# ref
參考書籍：
* c++ father, tour of c++
兩百頁講完 C++17 還有可能出現的新 C++20 concepts .., 範例少了一點
* c++ a crash course
* hands on system programming with c++
* Sanjay Madhay, Game programming in C++ 
* https://books.google.com.tw/books/about/Hands_On_Game_Development_with_WebAssemb.html?id=sfeaDwAAQBAJ&redir_esc=y

Tools
* godbolt.org

網路資源
* https://www.learncpp.com/
* https://thispointer.com/stl-tutorials-and-interview-questions/

線上課程：
* c++ course on [Udacity](https://classroom.udacity.com/courses/ud210), I don't like it this much.. but you can find c++ fater here talking about some concepts and history.
* Getting started with C++17

Lib
* lib of  audio, keyboard, mouse, joystick, and graphics hardware via OpenGL and Direct3D. https://www.libsdl.org/

materials
https://freesound.org/
https://opengameart.org/

* build
https://mesonbuild.com/sheel
ninja https://ninja-build.org/
cmake


# WASM
Wat web assembly text
how js interpreted https://www.youtube.com/watch?v=Fg7niTmNNLg

# Guides
https://www.quora.com/If-I-want-to-do-coding-for-a-living-what-are-the-languages-I-should-learn-and-the-things-I-should-do/answer/Basile-Starynkevitch
http://norvig.com/21-days.html
https://www.quora.com/How-can-I-practice-C++
https://www.reddit.com/r/cpp_questions/comments/88ipht/how_to_practice_c/