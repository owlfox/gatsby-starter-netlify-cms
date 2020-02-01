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

實際的處理器 / CPU 能操作的 ISA 可能都是對記憶體位址、暫存器做整數/浮點數（IEEE 754）的加減乘除、位元運算。
程式語言將 型別 / type 包裝成統一介面、提供在不同處理器架構、下同樣的行為。

# basic types in C
char
int
void

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


