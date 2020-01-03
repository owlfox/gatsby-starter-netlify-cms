---
templateKey: blog-post
title: Better embedded software ch20 notes 
date: 2019-12-23T00:00:00.000Z
description: study note
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - embedded
---
Chapter 20 Mutexes and Data Access Concurrency
===
###### tags: `mutex`, `concurrency`, `better-embedded`
> 這裡是對CMU的Philip Koopman教授的著作 [Better Embedded System Software](https://www.amazon.com/Better-Embedded-System-Software-Koopman/dp/0984449000) 20章 做的翻譯練習。
關於 C 語言提供的 atomic 操作支援或許可以看看:
> * https://en.cppreference.com/w/c/atomic
> * modern C 最後一章 https://gustedt.wordpress.com/2019/09/18/modern-c-second-edition/

重點提示
* 各 tasks 共享的變數必須要有保護並行(concurrency)操作的機制來避免臭蟲/bug。
* 常見的危險動作是 multi-byte 的資料在讀取過程中被更新、硬體暫存器在讀取中被改及對一個數值同時進行多個寫入操作。
* 介紹 volatile 關鍵字、 透過 interrupt masking 進行 atomic 修改、 data queue 及 mutex（互斥鎖）等並行作業處理機制。
* 要讓一段程式在多執行緒情況下 reentrant，必須進行的額外處置。

章節內容：
* 20.1 章節概要
* 20.2 資料共享之危險因素 / hazard
資料讀取中被修改或是多個寫入作業對同資料做操作都是危險動作。另外也要小心處理 multi-byte timer 數值 rollover/反轉的情況。
* 20.3 資料保護策略
所有被多項作業 task (包含 ISR ) 共享的資料結構都必須加上可行最輕量的並行保護（concurrency protection）。常見保護機制有：volatile(C/C++), 藉由 masking 中斷實作的 atomic 修改、queue、 double buffering, mutex
* 20.4 Reentrant 的程式
只用動態 allocated 的資源、讓你的程式碼能讓多個 task 同步運行。
* 20.5 坑/pitfall
* 20.6 更多資訊
也可參考 14 章 Real time / 實時系統, 19 章 邪惡的全域變數

# 20.1 前言
定義 concurrent/並行:  
並行者，concurrency。兩作業/操作/logical flow 於任何時間點同為 "active" 狀態即為之。
> 即便該其一處在 暫停 / suspended 的狀態，而只有其一在運行也算。任何 B 開始之後 A 還沒完成他的工作的 task 都算 concurrent.
並行對嵌入式系統來說很常見，該系統可能一邊無盡的執行控制演算法而同時系統還是保持在正常運行狀態，絕大多數的嵌入式系統某種程度上來說都會面臨並行議題。

當一筆資料或是記憶體位址在任一時間點被一嵌入式系統裡的不同作業/task共享時，問題就有可能發生。簡單來說，問題發生在於其一 task 誤以為其他 task 不會動該筆資料。換句話說，並行問題發生在兩個 task 在同一個資源/資料的使用上無法共事。特常見的案例是當 ISR 改了一個共用資料, 導致正在存取主要程序陣亡。因而我們必須確保資料在會被其他 task/硬體 修改的情況下，取得/寫入正確的資料。
一般我們有兩種解法，一是上鎖或是保護該資料在不會導致系統行為異常的前提下才能被讀取、修改。其二是使用不容易受到並行問題影響的機制來做 task 同步，如 queue, 讓共用的程式碼變得 reentrant 等。

## 20.1.1 使用並行資料處理技巧的重要性
絕大多數的嵌入式系統都有並行問題。只要你開始有多個 task 從軟體系統的不同模組存取同一資料、或是使用中斷處理，你就是並行問題的高風險群。
找出一個系統是否有並行臭蟲很難，因為症狀發生取決於特定時間點不同子系統的狀態。開發期就積極並鉅細靡遺的找出並行問題非常非常重要。當你在測試或是部署階段才來做，找出問題的難度及修正的成本都會非常高。

## 20.1.2 可能症狀
總體而言，並行問題可能症狀是偶發錯誤、無法朔源到哪一行程式碼有問題（因為要摻在一起才會出錯）：
X 偶發、看似沒有規律的錯誤，在特定模式下可能更容易發生。
透過檢視原始碼，你可能會找到以下症狀：
X ISR 會更新記憶體或是變數數值，但其他使用該資料的 task 沒有停用中斷的機制。
X 全域變數沒有上 mutex 或是其他保護機制。
X 硬體資源沒有上 mutex 或是其他保護機制。
X 變數會被其他 task 或是硬體變更，但存取該變數的軟體沒有強制重新載入最新數值的機制。
X 共用的函式庫裡面用了 static 、 全域變數或 non-reentrant 的資料結構。

## 20.1.3 資料共享控管不當的風險
* 難以重現、偶發的，可能在出貨之後才現身的臭蟲。
* 資料在讀取過程中被改動、出現不可能有的錯誤數值。造成系統錯誤、誤動作、當機情事（視系統的資料驗證機制設計而定）

# 20.2 資料共享的危險因子
資料共享問題容易在一個 task 可以搶占（preempt）其他 task 的情況下發生，這不限於 task swtiching, 也包括 ISR. 因為 ISR 的案例是較常出現，後面會有 ISR 的例子。但是要注意只要有任何兩個 task 並行運作就有可能會出問題。
## 20.2.1 讀取中資料被更新
最經典的案例是 timer 的數值在讀取的時候被其他 ISR 更新。這裏用 16 bit day, 8 bit hr, 8bit min, 8bit sec 的 5 byte 資料結構做例子：
```
void GetDateTime(DataTimeType *DT) {
  DT->day = TimerVal.day;
  DT->hr = TimerVal.hr;
  DT->m = TimerVal.m;
  DT->s = TimerVal.s;
}
```
呼叫這段程式可以讀取現在時間到 DT 這個變數裡。
想像你更新 DT 的變數到一半的時候，ISR 搶如並把時間更新，而且好死不死剛好整點時候發生：
d=255, hr=23, min=59, s=29
正常會是：
256, 0, 0, 0
但你可能會拿到：
0,0,0,0 //最慘，日期的 8bit cpu 低位 byte 進位的時候發生
255,0,0,0
255,59,0,0
255,59,59,0

這裏有兩個嚴重的問題，一是不常發生，可能萬中無一。二是嚴重性更高的問題更不容易發現：如 分、秒的錯誤對系統可能沒有大影響，但一旦 小時、日等級的錯誤發生可能就會對系統造成影響。
這些進位/rollover問題可能對你的系統或是顧客不是大問題，但是這裏試圖要點出的是當我們沒有對此類問題的正確認知的時候，找出問題是極其困難的。

## 20.2.2 對 register 資料做更新
```
inline unsigned int GetTimer(void) {
  unsigned int *TimerAdd = 0X87;
  int rtn;

  rtn = *TimerAdd;
  return(rtn);
}

for(i=0; i<1000; i++){
  data[i].value = A2D();
  data[i].time = GetTimer();
}
```
以上的範例程式裡，系統會去更新記憶體的 timer 數值，而我們將記憶體內的 timer 讀值和取樣資料存在 data array 裡，看起來沒什麼問題。
當 編譯器最佳化時可能會覺得這段程式碼都對同個記憶體位址存取，於是把程式碼編成這樣：
```
rtn = *TimerAdd;
for(i=0; i<1000; i++) {
  data.value[i] = A2D();
  data[i].time = rtn;
}
```
最後每一筆時間拿到的數值都一樣！
解決方案就是用 volatile 關鍵字！ 避免讓編譯器誤會，做不必要的的最佳化。

> 這裡可以參考 CS:APP 3e 的第三章，了解 C 語言與記憶體的存取指令的關係。

## 20.2.3 多個 writer
最難的問題通常是要讓多個 task 並行更新同一記憶體位置資料、寫入資料到輸出裝置或是取得共享資源的寫入權限。比起確保多個 reader 讀到正確資料，多個 writer 要難得多。 我們必須要有個防呆機制好讓系統多個 writer 之間能交互作業。這些問題非常難解，除非你用我們後續介紹的方案。
舉個例子，系統任一個 task 都需要寫入錯誤或是事件 log, 意味著同一時間只能有一個 task 對 log 做寫入，如果沒做好，我們就會看到一堆垃圾、莫名的 log。這類問題的行為跟我們上面提到的 Timer 問題類似，只是我們現在有了多個 writer 一起湊熱鬧。後面我們將介紹怎麼解決此類問題。

# 20.3 資料保護策略
做法很多，最好是挑可解決你的問題裡最清涼的那種。
## 20.3.1 volatile

```
volatile int X;

y = X+X; //讀兩次 X 的數值然後加總
```

沒加 volatile compiler 編出來的 code 可能是把 X 在暫存器裡面的東西加兩次。
加了，很不一樣！可能 X 兩次讀出來的數值不一樣
* 適用於有記憶體映射的 io、會被 ISR 更新的數值、記憶體位址。
再看一個例子：

```
volatile static int NewValue;

TASK 1:
while(){
  NewValue = ReadIO();
  //... 等 IO 準備好
}

TASK 2:
for(I=0; i<SampleTimes; I++>){
  X[I] = NewValue;
  //... 等一下下再取樣
}
```

1: 如果沒加 volatile, NewValue 可能從來不會被寫入新的資料。 compiler 以為這段 code 在 while loop 結束的時候寫最後一筆就好。
2. 如果沒加可能每個取樣拿到的數值都是一樣的， compiler 覺得奇怪，一樣的事情你幹嘛做那麼多次， NewValue 全部用在暫存器上面的數值就好了。

* volitile 的缺點：
1. 沒法針對多個寫手進行保護
2. 沒法對需要多個指令進行讀寫的程式進行保護，要上鎖。

## 20.3.2 原子小修改跟停用中斷
定義：
Atomic 操作，一旦啟動，完成前不可斷之。
```
volatile int X;

X = X+1;
```
假設以上程式在 16 bit mcu 運行，但是支援對記憶體位址 8bit數值+1的操作。
以上的程式碼只要其他 task 沒對 X 做寫入基本上沒什麼問題。編出來的實際 ISA 指令可能是：
1. 將 X 從記憶體載入到暫存器/16 bit
2. 加 1
3. 存回去/16 bit
但很有可能編譯器覺得以下的 code 比較快（3 -> 2, 33% perf buff!!）
1. 對 X 低位 byte + 1 產生 carry flag
2. carry + 0 後加到 X 的高位 byte
於是有人在 1, 2 之間讀 X 就爆炸了，因為就在這兩個指令之間，X 裡面的資料是錯的。這類情事類似前面提到的 timer 翻轉。怎麼修：
```
volatile int X;
DisableInterrupts();
X = X+1;
DisableInterrupts();
```
大多數的嵌入式系統停用中斷只是一個指令的事情，所以效能開銷不大。在處理多位元/word 大小的資料、處理器支援 單 byte 操作指令的時候各位看官要多加小心。另外中斷停用之後儘快復原。
有時候中斷可能已經部分停用，記得要把當下 interrupt mask 存下來，復原的時候回歸原狀。

## 20.3.2.2 與硬體相關的原子小操作
當一個記憶體位址有不受 CPU 控制的硬體會存取的時候...
硬體需要支援此類 multi byte 資料存取的操作，乖乖等到 CPU 完事了再去讀寫資料。有些硬體有支援此類 atomic 操作，有些則是會停幾個 clock 讓你更新資料，然後不巧遇到更新到一半就爆炸了。
確保此類資料都具有原子性是個比較好的做法，為達到此目標我們常常必須停用中斷、把更新動作做得愈快愈好。
## 20.3.3 queue
當我們遇到一個 task 資料 寫入/產出 的速度比另一 task 消化/處理快的時候，queue可以派上用場。shared varialbe 沒什麼用因為他一被複寫之前的數值就不見了。取而代之的 queue, 或是 First in dirst out buffer(FIFO) 可以暫時讓資料被負責處理的 task 消化完之前保存起來。
Queue 的重點是同一時間 queue 的 資料, tail, head pointer 都只能有一個 writer。一旦有複數 writer 時事情就會變得比較複雜。不過好消息是我們可以透過 queue 的特性簡化同步的複雜性：讓 head pointer (下一筆要讀的資料) 只能被 讀取的 task 修改、而 tail pointer 只被 資料生產者 修改。還有很重要的一點是要在適當實際加上 volatile, 停用中斷 確保對 head, tail pointer 的操作並不會造成同步問題。
> queue 適合用於資料串流共享，單一寫入/讀取者的情況。
## 20.3.3.1 queue 以來避免並行問題
以下是 queue 的範例程式碼，這裡作者用 array index 來代替 pointer 的使用。
```
// 以下需放在個別的 .C 檔 內以避免其他程序存取 static 變數
#define FIFOSIZE 10
#define PASS 1
#define FAIL 0
static int fifo[FIFOSIZE];
static short unsigned int head=0, tail=0; // 初始化空的 queue

// 插入元素到 queue 裡
// 成功回傳 TRUE，否則 FAIL
bool insert(int x)
{
  int newtail;
  newtail = tail+1;

  //有必要的話，換 tail 位置到 FIFO 的開頭處
  if(newtail >= FIFOSIZE) {newtail = 0;}

  // 如果 tail 跟 head 一樣，滿了
  if (newtail == head) { return(FAIL); }

  //更新 pointer 之前先寫資料
  fifo[newtail] = x;
  tail = newtail;
  return(PASS);
}
```
此處重點是避免 writer, reader 操作同一份資料，我們必須假定每當我們更新 pointer 的位置，其他 task 就有來存取新資料。
先更新資料，最後再更新 pointer 位置是這段程式碼能用的原因，這讓 consumer 在資料準備好之前沒辦法讀取該資料。更新 pointer 的操作必須要是 atomic，這樣 consumer 才不會拿到更新到一半的 pointer/multi-byte 數值。這裏作者利用的技巧是使用 short integer (single byte/word)，因此對其更新是 atomic。 移除 queue 的元素也是比照辦理，
## 20.3.3.2 double buffering
double buffering 的技巧算是 queue 的特例，在 double buffering 的系統裡，有兩個同樣大小的 queue，當 writer/reader 各擁有一個 buffer 的所有權，只在兩邊都準備好的時候，再交換 buffer 的所有權。 double buffering 通常用在較大的資料結構，如 video frame buffer。也可以當作 FIFO 的建議替代方案。

## 20.3.4 Mutexes
定義:
mutex 保證上鎖之後即便 task 轉換所有權也不會變動，是個排他的宣告共享資源所有權方法。
->MUTualEXclusion, 即便再多 task 要取得一份資源，也只有一人能得。
(semaohore 跟 mutex 機制類似，只是可以讓多於一個個 task 同時存取)
mutex 的運作機制是透過一個變數來表示是否有個 task 正在使用該資源。當一個 task 正在用，mutex 會被設定成鎖定，其他 task 都會被排除在外。而當該資源沒人在用， mutex 就會被解鎖。以下會用個例子來說明。
> 如果沒有更簡單的上鎖機制能用，那就用 mutex 吧！
首先我們定義兩個變數，一個是 mutex, 一個是要保護的共享資源，隨你想保護什麼，它可以是 multi-byte 數值、大大的資料結構、硬體資源。一旦你用了 mutex ，要保資源的類別就沒有限制。注意 mutex 是一個 重量級的 保護機制，請務必在沒有其他更輕量的手段時才考慮 mutex。

```
//可以是 struct 或是其他你想保護的東西
volatile int SharedData;

#define UNLOCKED 0
#DEFINE LOCKED 1
volatile unsigned short int SharedDataMute = UNLOCKED;
```
共享的資料和 mutex 都應該只能被需要用到的軟體模組存取。他們常常會被設計成全域變數，但那並非唯一的解決方案。在 C++ 你可以透過物件來包裝共享資源及透過 method 來包裝存取 mutex object 的程式。（參考第 19 章 邪惡的全域變數)
當系統開始運作，mutex 為 0，代表解鎖。當一個 task 想要取得所有權，可能會有兩種共享情境：一是該資源已經有人在用，二是其他 task 也想取得所有權。當多個 task 競爭同個資源的時候，可能會在取得資源過程中發生 task switch ，造成兩個 task 都誤以為取得所有權的誤判情形。這個問題可以透過以下稱為 spinlock 的實作來排除（又稱 test and set lock）：
// 試圖鎖定資源
void GetMutex(volatile unsigned short int * Mutex) {
  unsigned short int InitalValue;
  
  //以下的迴圈會執行到 InitalValue 為 unlocked 為止（代表這個 task 已經成功取得 mutex 並上了鎖）
  do {
    DisableInterrupt(); //確保 atomic
    InitialValue = *Mutex; //取得現在的數值
    *Mutex = LOCKED; //試圖上鎖
    EnableInterrupt();

  } while (InitValue == LOCKED)
}
//完事了以後解鎖
void ReleaseMutex(volatile unsigned short int *Mutex) {
  *Mutex = UNLOCKED; //解鎖
}

//使用 mutex 的範例程式會像這樣：
GetMutex(&SharedDataMutex);

//拿到 mutex 以後我們就可以為所欲為！
```
ReleaseMutex(&SharedDataMutex);
//現在其他人也可以使用該資料
```

這裡我們只有在 *Mutex 是 UNLOCKED 狀態才能取得 Mutex 所有權。如果有其他 task 正在使用該資源（LOCKED）對 *Mutex 上鎖不會造成所有權的改變。只有等到有人釋出 mutex，InitialValue 才為 UNLOCK，才能上鎖。這裏作者假設我們使用 preemptive task switching 的系統，當其一 task 正在迴圈中，處於中止/suspended 狀態，其他 task 也能運行。
停用中斷是為了確保上鎖過程那兩行 atomic，避免 task switching 導致同時多人拿到鎖的情況。
這樣來存取 shared variable 真的很費工。但好處是我們只停用了中斷一下子而已。其他時間中斷都有被啟用，包含勝利組 task 正在使用該資源的時候。注意這可能會對 反應時間/response time, 實時系統排程/ real time schedulability 有影響。
（說到排程，如果你是在單 CPU 的環境作業，當拿不到 mutex 的時候 使用 yield 等 syscall 來讓其他 task 可以更快完成他們的工作是個較好的做法。畢竟當同一時間只有一個 task 可以運行的時候，一直重新試著去解鎖是沒有意義的。）
mutex 同時也是很多經典同步問題的發生原因：
* Priority inversion: 重要的 task 需要等 較無關緊要的 task 解鎖才能拿到 mutex。這在 queue 裡面也會遇到，例如 queue 滿的時候要等，但是一般來說 mutex 的情況會比較難除錯。
* Deadlock: 當兩個 task 手裡都有對方想要的資源的時候發生。除非有特別設計排除機制，他們兩會一直等下去.

# 20.4 Reentrant code
當我們可以讓多於一個 task 使用一個程式模組而不會有並行錯誤，我們稱其 reentrant [可再入](http://terms.naer.edu.tw/detail/2415749/?index=4)。此類程式碼常見於數學函式庫、I/O 驅動，錯誤處理/error handler. 通常此類特性可藉由只使用 stack 或是暫存器來管理變數達成。 C 的話就是不要用可惡的全域變數、 static keyword, 確定沒有指針指到共用的記憶體位置。
基於便利考量，當我們寫族語的時候習慣會用固定的記憶體位址來處理資料 （direct / extended memory address）而非 stack。
如果你真的必須要用全域或是 static，記得加上前面我們說到的保護機制。但代價就是效能損失。
> 作者建議任何一段會被多個 task 使用的程式都要寫成 reentrant

# 20.5 坑
最容易包的地方是一開始就對並行作業不理解/尊重。並行處理要做得好是很不容易的，很容易自我感覺良好用了特定的輕量並行機制，曲解了該遵循的規範。此類案件，大多數當事人都會爆炸！！！更慘的是你有可能是在開發完成進行一系列測試的時候才發現問題，或是已經出貨了才發現。假如你不是個並行專家，建議還是用驗證過的手法來實作。即便你真的是個專家，作者建議你還是應該乖乖用驗證過的工具。

# 20.6 更多資訊：
## 20.6.1 關鍵字
* data queue
* mutex
* semaphore
* reentrant code
* thread safe

## 20.6.2 建議閱讀
* Gannsle j. "Reentrancy" embedded system programming april 2001 pp183-184
簡介 reentrant code
* Beatty, S., "Where testing fails" embedded system programming August 2003 pp36-41
從測試及除錯的觀點討論並行議題