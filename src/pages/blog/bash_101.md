---
templateKey: blog-post
title: Bash 101
date: 2020-03-11T00:00:00.000Z
description: notes of bash 
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - bash
---
To interact with Linux, the operating system, we can use shell, a program which parses the commands we input, execute, and return the results. For the history of shell and why people interact in this way, check out this [video](https://youtu.be/Q07PhW5sCEk) on early days of computers by MIT.

> I often think of shell as the outer "shell" while interacting the inner working kernel - operating system.

You might ask why not use mouse to click the buttons and do the similar things. Advantage of using scripts or commands to directly interact with the OS:
* Faster than GUI(Graphical user interface)
* Users may customize the tools to match the needs

# Hello world!
To get started let's ask the computer to say hello and get around with shell.
```
echo hello world
pwd
cd /tmp
touch a.txt
ls -al
echo "'hello!!'" > a.txt
```
> To find the information of the commands try `help cd`, or `man ls`, `..`, `.` are special directories represents parent folder and current folder

# scripting in shell - bash
There are many different implementations of shell. I have been using bash and zsh. A example of using bash script is like below:

```
#!env bash
v1="A string"
echo "$v1 is a string, time is $(date)"
echo $@
```
The line started with # means it's a comment. while `#! something` is a special comment about which command to execute this script. we may assign a value/string to a variable and then interpolate it into other commands.

# Reference
[1] Missing sementer [shell](https://missing.csail.mit.edu/2020/course-shell/), [shell
scripts](https://missing.csail.mit.edu/2020/shell-tools/)
