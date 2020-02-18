---
templateKey: blog-post
title: notes of tmux & vim
date: 2020-01-27T00:00:00.000Z
description: notes 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - tmux
  - vim
---

# Vim
## files
with netrw

* ref 
[guide](https://shapeshed.com/vim-netrw/)
## dot command
## scripting
## configs

# moves

zz to center your page

## jump
<C-i> <C-o> to jump back & forward

## panes
<C-wv>, vertical split
<C-wh/j/k/l> move around panes
* shell cmd in vim
:! cmd ...



* turn on/off line number
:set number
:set number!

* copy doc to clipboard
https://stackoverflow.com/questions/1620018/copy-all-the-lines-to-clipboard

## move
HLM
[Control][b] - Move back one full screen
[Control][f] - Move forward one full screen
up down
[Control][d] - Move forward 1/2 screen
[Control][u] - Move back (up) 1/2 screen

change stuff in matching brackets, quotes, ...
ci', change everyting "in" ''
ca[, change things around [], [] will also be changed
% to jump between matching marks

J to Join this and the next line
zsh:1: command not found: ++enc=utf8
## vundle, plugins
[remove plugin](https://github.com/VundleVim/Vundle.vim/issues/733)
* easymotion
* ycm
* 

# tmux
把 pane 彈出到獨立 window
prefix+!

把 window 合併到

## plugin 管理

* clipboard
