---
title: "Why a ramen stall and not a portfolio template"
date: 2026-10-08
status: published
excerpt: "What an interactive front door gives you, and where it just gets in the way."
tags: [portfolio, design]
order: 1
---

I wanted a portfolio I would actually enjoy opening and keep updating, not another template. So I put mine inside a late night ramen stall. You can sit at the counter, order a bowl and watch the cook serve it. I built it with Astro and three.js, with a lot of help from AI coding tools.

## The stall is a front door, not a gate

The rule from day one was simple. Nobody should have to play with a 3D scene to find out who I am. The Menu, the Guide, the Kitchen Log and the Bill are normal pages at `/menu/`, `/guide/`, `/log/` and `/bill/`. They work without JavaScript, without WebGL and without waiting for a model to load. If you are a recruiter in a hurry, the Bill is one click away.

![The NightBowl stall with the cook and the diners](/images/nightbowl-share.png)

The scene only adds things on top. When scripts run, the same links open the menu book inside the stall. If the 3D part fails or is slow, the pages are still there. Keeping both versions costs some extra code, but I would rather pay that than have the portfolio disappear on an old phone.

## The content lives in files

Posts, projects and all the text on the site are plain Markdown and JSON in the repository. I edit them through a small admin page, and every save is a commit on GitHub. There is no database to keep in sync. When I push to main, Cloudflare rebuilds the site and it goes live on nightbowl.live.

A project gets a short summary on the menu. It only gets its own page once I have written a proper case study for it. Source code and live demos are separate links, so you always know where a link takes you.

## Animation needs one clock

The scene has a lot of things that depend on each other. The cook serves a bowl, the diners eat, finish, order again and leave, and new diners walk in. My first version paused only the drawing. The timers kept running in the background, so when you came back a diner could jump ahead while the bowl stayed behind.

Now everything reads from one shared scene clock. Pausing, reduced motion and reading the menu all stop that clock, and the scene picks up exactly where it left off. Walking is tied to the distance a character moves, not a separate timer, so feet stay planted on the floor.

## What the tests do not prove

The home page has a size budget, and the browser tests check the layout, the menu, the meals and the walking on phone and desktop sizes. Those tests run with software rendering, so they say nothing about frame rate or battery on a real phone. I still need to test it properly on real devices.

The cook and the diners are simple shapes for now. I am building my own cook in Blender next.

The code is on [GitHub](https://github.com/Riteshbhandarii/NightBowl).
