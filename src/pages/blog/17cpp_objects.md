---
templateKey: blog-post
title: notes of C++17
date: 2020-01-27T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---

# Objects
Object can be 
* primitive type, int, char, float, ... 
* user defined class, struct

如果物件的資源複製/移動、取得/釋放資源涉及 new/delete 的呼叫，則可能用 constructor, deconstructor 管理較佳。
```
class X { 
int member_int;
double m_double;
  public:
X(Sometype);  //
X(){} // default constructor, member initialized as 0
X(double d) :m_double{d} {}
X(const X&); // copy constructor 
X(X&&); // move constructor
X& operator=(const X&); // copy assign
X& operator=(X&&); // move assign
 ̃X(); //


};
``` 

* explicit Vector(int s); 要求必須要透過 function call 來做初始化
```
沒加的話
complex z1 = 3.14; // z1 becomes {3.14,0.0}
complex z2 = z1∗2; // z2 becomes z1*{2.0,0} == {6.28,0.0}
加了棒棒
Vector v1(7); // OK: v1 has 7 elements
Vector v2 = 7; // error: no implicit conversion from int to Vector
```

# =
```
X x1, x2;
x1 = x2
```
預設會把 member data  複製過去
至於 vector 之類的 resource handle/container

```
Vector<X> v1, v2;
v1 = v2;
v2[0] = ... //modify the same vector..
```
另外 vector.size 不同也有問題

handle 類物件 如果真的需要這類語法，需要自行定義
```
class Vector { 
private:
  double* elem;
  int sz; 
public:
  Vector(int s);
  ~Vector() { delete[] elem; }
  Vector(const Vector& a);
  Vector& operator=(const Vector& a);
  double& operator[](int i);
  const double& operator[](int i) const;
  int size() const; 
};

Vector::Vector(const Vector& a) // copy constructor 
:elem{new double[a.sz]}, // allocate space for elements
sz{a.sz} {
for (int i=0; i!=sz; ++i) // copy elements elem[i] = a.elem[i];
}
Vector& Vector::operator=(const Vector& a) {
double* p = new double[a.sz]; 
for (int i=0; i!=a.sz; ++i) // copy assignment
  p[i] = a.elem[i]; 
delete[] elem;
elem = p;
sz = a.sz; 
return *this;
// delete old elements
}
```

# move
當我們不需要 複製 container 資料例如做 map, reduce 等運算。
* &&
```
Vector::Vector(Vector&& a) 
  :elem{a.elem}, // "grab the elements" from a
  sz{a.sz} {
    a.elem = nullptr; // now a has no elements
    a.sz = 0; 
}
```

std::vector<thread> my_threads;
Vector init(int n) {
thread t {heartbeat}; // run heartbeat concurrently (in a separate thread) my_threads.push_back(std::move(t)); //movetintomy_threads(§13.2.2)
// ... more initialization ...
Vector vec(n);
for (int i=0; i!=vec.size(); ++i)
vec[i] = 777;
return vec; // move vec out of init()
}
auto v = init(1'000'000); // star t hear tbeat and initialize v
```


# RAII
在定義各個物件的 owner 之後，C++ 在物件脫離可用 scope 之後機會自動釋放資源，並有跟例外處理機制結合。
memory (string, vector, map, unordered_map, etc.), files (ifstream, ofstream, etc.), threads (thread), locks (lock_guard, unique_lock, etc.), and general objects (through unique_ptr and shared_ptr).
都是透過 RAII 包裝成好用物件的範例。


# Questions
1. 作者提到分散式系統愈來愈多、 locality 重要性與日俱增，最好別依賴 GC 是什麼意思？
目前看起來的感覺是 lock, file handle 等各類資源最好都要有效的釋放，才不會造成系統反應變慢。
# ref
A tour of C++