---
title: "Why a ramen stall and not a portfolio template"
date: 2026-09-08
status: draft
excerpt: "What an interactive front door buys you, and where it just gets in the way."
tags: [portfolio, design]
order: 1
---

Technical notes for Ritesh's review. This is a draft, not the final first-person
story. The cast is still procedural placeholder art.

## The stall is a front door, not a prerequisite

NightBowl puts a portfolio inside a late-night ramen stall. Visitors can sit
down, choose a bowl and watch the cook serve it. Those interactions are optional:
the Menu, Guide, Kitchen Log and Bill must remain readable without entering the
scene, ordering food or waiting for a model to download.

![The current NightBowl stall with its procedural placeholder cook and diners](/images/nightbowl-share.png)

The content is ordinary HTML rendered by Astro. The navigation has real
destinations at `/menu/`, `/guide/`, `/log/` and `/bill/`. An inline controller
enhances those links into the book interface when scripts run. It does not
depend on the larger three.js scene module. Without JavaScript, the entrance
offers the same four destinations and removes the loading overlay.

That separation is a deliberate tradeoff: maintaining both the book and reading
layouts costs some presentation code, but a failed or slow WebGL scene does not
make the portfolio disappear. Browser tests disable JavaScript, hold the scene
module and exercise the reading pages at desktop and narrow-phone widths.

## Keep the content in files

Posts, project stories and site labels live in the repository as Markdown and
JSON. Keystatic edits those files locally during development and uses GitHub
authentication in the production build. There is no separate content database
to synchronize with the site.

A project's short public summary is separate from its extended Markdown body.
Only an explicitly published case study gets a `/menu/<slug>/` route. A draft
can contain contribution, context, stack and a longer explanation without
putting those fields into the public menu. Source-code and live-demo links are
separate destinations rather than a single ambiguous project link.

This makes publication review visible in Git, but saving an edit is not the
same as publishing a deployment. The host still needs to rebuild the site.
Draft post previews are `noindex` and excluded from the sitemap; they are not
authenticated or confidential. Do not put private research data in them.

## Animation needs one definition of time

The scene includes several dependent actions: serving a bowl, taking bites,
finishing a meal, asking for another round and replacing a departing diner.
Pausing only the render loop would leave wall-clock timers running. On resume,
an actor could skip ahead while a bowl or limb stayed behind.

Autonomous actions now read a shared scene clock. Manual pause, reduced-motion
mode and reading the book exclude paused wall time. Resume continues service
and turnover from the same state. Explicit actions still work in static mode:
taking a seat skips the entrance, and an order places a full bowl without
claiming that the visitor has eaten it.

Walking is tied to distance travelled rather than an unrelated sine-wave
timer. Regression checks measure planted feet and sparse-frame departures as
well as the meal lifecycle. Pose and clock snapshots catch state jumps; paired
screenshots check that a manually paused scene really stays still.

## What the checks do not prove

The public home has a 750 KiB raw and 250 KiB gzip first-party transfer budget.
Geometry and interaction checks run in browser automation, including software
rendering. Software-renderer timing is not a real phone's frame rate, GPU cost
or battery behaviour. The physical-device launch pass is still outstanding.
Static mode freezes motion but still draws frames and allows camera interaction.

The final cast, approved project stories, real CV, public contact address and
production domain are separate launch work. None should be replaced with
invented assets or presented as complete by a passing build.

Source: [NightBowl repository](https://github.com/Riteshbhandarii/NightBowl),
[scene and lifecycle code](https://github.com/Riteshbhandarii/NightBowl/blob/main/src/lib/scene.js),
and [the automated checks](https://github.com/Riteshbhandarii/NightBowl/tree/main/scripts).

Before publication, Ritesh must replace these notes with his own explanation of
the choices and limits, review the screenshots and deliberately switch the
post from Draft to Published.
