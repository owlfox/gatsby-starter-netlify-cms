---
templateKey: blog-post
title: SSD筆記 - part1 引言
date: 2019-11-25T00:00:00.000Z
description: 'SSD 學習筆記，翻譯與修訂自 http://codecapsule.com/2014/02/12/coding-for-ssds-part-2-architecture-of-an-ssd-and-benchmarking/'
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - coding for SSD
  - 正體中文
---
# 緣由
Emmanuel Goossaert 是 booking.com 的工程師，他因為想拿 SSD 做自己的 [key-value store](https://github.com/goossaert/kingdb) 專案的儲存方案，開始學習 SSD 相關知識。這六篇文是他在 2014 年寫下，裡面很多的參考資訊可能都找不到了，但是我剛好在準備 SSD 相關工作面試，想想還是有參考價值，所以做了簡單翻譯，跟一些筆記，再加一些[蔥](https://tw.appledaily.com/highlight/20191118/IP3YJZUFPZZDLFPUP7DYDVUAKA/)。

> 蔥長這樣

原文請參考 [1](#coding for ssd part1)，系列文章請看 [coding for SSD](/tags/coding for ssd/) tag。

# 結論
作者對這系列文章的結論可以看[第六篇](/blog/2019-11-27-coding-for-SSD-part-6/)

# 我的結論

我自己是覺得這系列文章對於入門了解 SSD 還不錯。如果要做到這種程度的最佳化必須要很多人一起投入。
1. sysadmin 必須確認檔案系統、SSD 型號、作業系統配置。
2. developer 應用層的程式必須要注意錯誤的寫入/讀取的資料大小/頻率可能對 SSD 造成的過大壓力。

**難維護。**

就目前我的認知，需要做到對效能斤斤計較又很重要的系統瓶頸在 File system，需要對 SSD 特性客製化應用層程式的機會很小。
解決方案？選個好檔案系統？ 
## zfs
http://www.brendangregg.com/blog/2008-07-22/zfs-l2arc.html 裡面提到的檔案系統階層可能已經很好的解決效能問題，還送 copy-on-write，容錯機制，snapshot。
![](http://www.brendangregg.com/blog/images/2008/computer_model3.png)

zfs 也開始可以在 linux 上面使用，Ubuntu 19.10 也有直接把 zfs 裝成 roo FS 的選項。
如果是一般 server、文書、遊戲使用我會以後裝個 zfs 就好了。

至於更高端的選擇.. 可能是建 [cepf](https://ceph.io/) cluster，或是 open-channel SSD 等特殊解法？

# TODO
* 更新/除錯原作中的參考資料，看看有沒有更新版的資料。
* app->lib->syscall->vfs->fs->bus->PCIE/NVME->ONFI
* 寫點 code

## 更新時事新資訊
* Design Tradeoffs for SSD Reliability
https://www.usenix.org/conference/fast19/presentation/kim-bryan
https://www.usenix.org/system/files/fast19-kim-bryan.pdf
