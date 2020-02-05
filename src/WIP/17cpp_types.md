---
templateKey: blog-post
title: notes of C/C++ types
date: 2020-01-27T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
這篇紀錄
實際的處理器 / CPU 能操作的 ISA 可能都是對記憶體位址、暫存器做整數/浮點數（IEEE 754）的加減乘除、位元運算。
程式語言將 型別 / type 包裝成統一介面、提供在不同處理器架構、下同樣的行為。

# basic types in C
char
int
void
nullptr
bool
char8_t (since C++20)
char16_t (since C++11)
char32_t (since C++11)
int

# C++

# struct

# class

# packing


## pragma, alignas

```
#include <iostream>

#pragma pack(push, 2)

// alignas is more important
struct alignas(16) mystruct
{
    uint8_t data0;
    uint16_t data1;
    uint64_t data2;
};
// pragma dominates
struct mystruct1
{
    uint8_t data0;
    uint16_t data1;
    uint64_t data2;
};

#pragma pack(pop)

struct mystruct2
{
    uint8_t data0;
    uint16_t data1;
    uint64_t data2;
};


struct mystruct3 {
    uint8_t data0;
    uint16_t data1;
    uint64_t data2;
} __attribute__ ((packed));


//borrowed from csapp show_bytes.c
typedef unsigned char *byte_pointer;
void show_bytes(byte_pointer start, size_t len) {
    size_t i;
    for (i = 0; i < len; i++)
	printf("%p\t0x%.2x\n", &start[i], start[i]); 
    printf("\n");
}

int main()
{
    mystruct s{0X33,0XFFFF,0XAAAA'AAAA'AAAA'AAAA};
    mystruct1 s1{0X33,0XFFFF,0XAAAA'AAAA'AAAA'AAAA};
    mystruct2 s2{0X33,0XFFFF,0XAAAA'AAAA'AAAA'AAAA};
    mystruct3 s3{0X33,0XFFFF,0XAAAA'AAAA'AAAA'AAAA};
    
    std::cout << "size: " << sizeof(s) << '\n';
    show_bytes((byte_pointer)&s, sizeof(s));
    
    std::cout << "size: " << sizeof(s1) << '\n'; 
    show_bytes((byte_pointer)&s1, sizeof(s1));

    std::cout << "size: " << sizeof(s2) << '\n'; 
    show_bytes((byte_pointer)&s2, sizeof(s2));
    
    std::cout << "size: " << sizeof(s3) << '\n'; 
    show_bytes((byte_pointer)&s3, sizeof(s3));
}
```

* tools
https://linux.die.net/man/1/pahole





# 基本語法
# 函式庫
## string
## vector
## qeueu， dequeue

# cpp best practices
* 正確姿勢： Cpp core [guidelines](https://github.com/isocpp/CppCoreGuidelines/blob/master/CppCoreGuidelines.md)
* 10 takeaways with core guideline https://www.youtube.com/watch?v=XkDEzfpdcSg
* https://google.github.io/styleguide/cppguide.html

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

# Ref

