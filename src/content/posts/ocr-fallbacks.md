---
title: "Three OCR engines, one document"
date: 2026-10-29
status: draft
excerpt: "Why the document-extraction prototype runs PaddleOCR first and keeps Tesseract and EasyOCR as fallbacks."
tags:
  - "OCR"
  - "Python"
order: 99
---

Outline only. Write each section in your own words before publishing, and leave out anything the CoRe project cannot share.

## The documents

What kind of industrial documents, and what made them hard to read (scans, tables, stamps, handwriting, languages).

## Why PaddleOCR first

What it did better on these documents, and how you checked that.

## When it falls back

What triggers Tesseract or EasyOCR, in what order, and why that order.

## What I would change

One honest limitation of the prototype.
