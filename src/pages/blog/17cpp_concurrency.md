---
templateKey: blog-post
title: consumer, producer 
date: 2020-02-01T00:00:00.000Z
description: c++ system programming notes
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - c++
---
這一篇用一些 concurreny 的範例來學習 C++17 的 thread library

關於 concurrency 的定義可以參考 Better Embedded system software 20 章。

# 關鍵字
* pthread
* thread id
* address space
* join
* lock free
* Synchronization

# 正文開始
Since C++ 11, there's thread library available to use, before we had to use 3rd party libs like pthread, some comes with
more powerful abstractions like boost, POCO,
... etc. 
## bits of pthread
* We have to cast thread input/output or use global variable, which we would like to avoid all the time. Why? Once two
  tasks access a resource concurrently, it must be locked or handled with atomic measure to prevent hazard.

> Pthread provides in/out value, but we have to cast them with reinterpret_cast from void.
```
   pthread_create(&thread1, nullptr, mythread, &in_value);
   pthread_join(thread1, &out_value);
   pthread_self(); // return id
   sleep(1); // for better performance, battery life
   pthread_yield(); // not on unix, often scheduler does a better job than you

```

## Sync
* Race conditions, two tasks working on same resources.
Example of race condition:
[link](https://github.com/PacktPublishing/Hands-On-System-Programming-with-CPP/blob/c29f464c4df79f0d5a55a61f02a2558be74a329c/Chapter12/scratchpad.cpp#L187),
here used 8000 thread to show it.

To avoid that, we either use mutex(mutual exclusion,
[example](https://github.com/PacktPublishing/Hands-On-System-Programming-with-CPP/blob/c29f464c4df79f0d5a55a61f02a2558be74a329c/Chapter12/scratchpad.cpp#L229)) to protect a critical section.

```
pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE); // to allow lock more than once in a thread.
//conditional variable
pthread_cond_t cond = PTHREAD_COND_INITIALIZER;
while(!predicate) {
        pthread_cond_wait(&cond, &lock);
    }// to make threads run in desired order.

// what we do in other thread
predicate = true; pthread_mutex_unlock(&lock); pthread_cond_signal(&cond);
```
# std threads
* type safety，
  [example](https://github.com/PacktPublishing/Hands-On-System-Programming-with-CPP/blob/c29f464c4df79f0d5a55a61f02a2558be74a329c/Chapter12/scratchpad.cpp#L469)
```
std::packaged_task<int(int)> task1(some_function); // no more void!
auto f1 = task1.get_future();
std::thread t1(std::move(task1), 42);
t1.join();
···
 <threads> also provides supports like:
* yield,
* sleep_for(1s)
* std::lock_guard lock(mutex) RAII, while task's out of scope, release the lock automaticllay
* while(!mutex.try_lock()); do something else while witout lock
* lockguard for try_lock
```
while(!lock.try_lock()) 
{ 
    std::this_thread::sleep_for(1s);
}
```

