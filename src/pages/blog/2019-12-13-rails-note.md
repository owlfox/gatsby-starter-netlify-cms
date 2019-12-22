---
templateKey: blog-post
title: Rails note
date: 2019-12-13T00:00:00.000Z
description: rails note
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - rails
  - react
---
## 前情提要
這是基於五倍紅寶石課程的 rails 線上課程作業所寫的筆記。目前我還在練習可以在兩個小時內砍出一個功能 OK 的網站。
## rails
Ruby on Rails 是 Basecamp 公司用 Rbuy 語言開發的網頁系統程式框架 / Framework。框架可以想成建築物的設計/骨幹，使用這套工具可以套用許多既有的工具、know-how 來進行網頁程式的開發，加快產品上市時間。功能諸如：
0. MVC 方式規劃程式碼架構，方便閱讀及管理。
1. cors 攻擊防護
2. html template
3. ORM
4. rails generator 等模板程式產生工具
5. rspec 測試工具整合
6. 6.0 開始新增 webpack 整合
## ruby
Ruby 是 Yukihiro Matsumoto 設計的程式語言。不同於 C 語言需要經過 GCC/Clang 等需要編譯及預設在有作業系統提供之 Api/system call 介面才能運行的程式/執行檔。Ruby 的程式相對來說不能單獨運行，需要透過可以讀取 Ruby 程式語言的直譯器才能運作，類似 Python。
> 然而 ruby 的直譯器是用 C 寫的 XD。
## Gem
Gem 是 Ruby 用來打包程式的工具。我們可以將組織好的程式碼透過

# 專案練習
以下是開發各個課程作業的時候的練習檔
## Hello rails
## Blog
## medium
```
rails 6.0.1
ruby 2.6.3
React 16.6
rails new my_medium -d postgresql
# 如果想換 db 在 database.yml 改
rails db:create
# https://rubygems.org/gems/devise
gem 'devise', '~> 4.7', '>= 4.7.1'

rails generate devise:install
rails g devise User
# follow the instructions on https://github.com/plataformatec/devise

yarn add bulma
```
## Pomodoro

## Rails with React