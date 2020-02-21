---
templateKey: blog-post
title: Tcl and PERC notes
date: 2020-02-20T00:00:00.000Z
description: some notes of Tcl and its application
featuredpost: false
featuredimage: /img/bossybeddy.png
tags:
  - circuits
  - Tcl
---
# Glossary
* ESD
  electrostatic discharge, subset of EOS
* EOS


https://cse.nsysu.edu.tw/p/406-1205-167375,r3083.php?Lang=zh-tw
* stories of ESD 
https://www.ptt.cc/bbs/Tech_Job/M.1504455297.A.4DB.html
https://www.ptt.cc/bbs/Tech_Job/M.1505661716.A.793.html

# TCL
* how to [compile/install tcl](https://www.tcl.tk/doc/howto/compile.html)

## Tcl Basics
* Commands and variables
** puts, set
* Substitution and evaluation
** Mathematical operations
        Procedures
    Control Flow
        Conditional and looping commands
    Strings
        Strings and string operations
        Extracting information
    Lists and Arrays
        Using lists and arrays
        List versus array
    File I/O & Program Access
        Reading from and writing to files
        Invoking external programs
        Multi-process communication
    Regular Expressions (REs)
        Regular expression patterns
        String searching and replacement
    Advanced Tcl Scripting
        Advanced procedures
        Error handling
        Date & time
        Scheduling and delaying command execution


## basics commands
info patch
> show tcl version


## helpful tricks
rlwrap tclsh
> make tclsh more usable with history support
