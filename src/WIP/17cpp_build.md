---
templateKey: blog-post
title: notes of C++17 build tools
date: 2020-01-27T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---

# cmake
產出 makefile 的工具，讓跨平台編譯方便很多。
## 使用範例：
* Catch2

* with conan
* Test

# conan
C/C++ 套件管理工具
```shell
// 搜尋套件
conan search boost --remote=conan-center
// 設定想要安裝的套件跟編譯工具
vim conanfile.txt
```
* `conanfile.txt` 範例
```
 [requires]
 poco/1.9.4
 boost/1.71.0

 [generators]
 cmake
```

```
cd build
conan install ..
conan build
```

`CMakeLists.txt`, to include the dependacies
```
 include(${CMAKE_BINARY_DIR}/conanbuildinfo.cmake)
 conan_basic_setup()

 add_executable(md5 md5.cpp)
 target_link_libraries(md5 ${CONAN_LIBS})
```
# todo
* ninja

# ref
https://docs.conan.io/en/latest/introduction.html