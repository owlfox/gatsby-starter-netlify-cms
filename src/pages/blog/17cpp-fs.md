---
templateKey: blog-post
title: 17cpp, filesystem
date: 2020-02-19T00:00:00.000Z
description: c++ system programming notes
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
C++ 17 之後開始支援檔案系統的操作

Here comes an example of using filesystem library to "ls" a file.
(breaks on first whitespace or newline

https://gitlab.com/owlfox/random_things/-/blob/master/ls.cpp

A good way of opening file in C++ with RAII/no need to close the file.
for different modes of openning a file, see [this](https://stackoverflow.com/questions/12253183/stdios-baseate-and-stdios-basetrunc)(in, out, at the end, append, binary, ...)
```
#include <fstream>
#include <iostream>
int main() {
  auto file = std::fstream();
  constexpr auto mode = std::ios::out | std::ios::binary | std::ios::app;
  if (file.open("test.txt", mode); file.is_open()) {
                std::cout << "success\n";
  }
}
```

To read/write a file, we can use stream operator to do that.
Which behaves just like cin and it's type safe.(breaks on first whitespace or newline
```
string hello, world;
file >> hello >> world;
```
