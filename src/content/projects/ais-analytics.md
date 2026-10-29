---
name: "AIS vessel analytics"
course: "mains"
tag: "PostgreSQL · MQTT"
summary: "A live data system for ship traffic. It ingests Digitraffic AIS messages over MQTT into PostgreSQL, runs an ETL loop every 30 seconds, projects each vessel's next positions and serves them through a FastAPI API and a map dashboard."
status: "published"
contribution: "Team lead in a team of four. I designed the architecture, coordinated the work and built the live ingestion from Digitraffic into PostgreSQL."
context: "Course project at Turku UAS. The goal was a working end-to-end system, from a live external feed to a dashboard, that keeps running on its own."
stack:
  - "Python"
  - "PostgreSQL"
  - "Paho MQTT"
  - "pandas"
  - "FastAPI"
  - "Leaflet"
  - "XGBoost"
sourceUrl: "https://github.com/Riteshbhandarii/ais-analytics"
featured: true
image: "/images/projects/ais-architecture.webp"
imageAlt: "Data architecture diagram of the AIS analytics system, from the Digitraffic MQTT feed through PostgreSQL and the ETL loop to the API and dashboard"
order: 1
draftCopy: false
---

## The problem

Ships around Finland broadcast their position, speed and heading over AIS, and Finland's Digitraffic service republishes those messages as a live MQTT feed. The data is free and it never stops. The job was to turn that stream into something a person can look at: where each vessel is now and where it is likely to be in the next few minutes.

## What we built

The system has four parts, and each one does a single job.

1. **Ingestion.** A subscriber listens to the Digitraffic topics and writes every raw position message and every vessel metadata update into PostgreSQL. Raw data is kept as it arrived, so any prediction can be traced back to the message it came from.
2. **Storage.** Three tables: `vessels` for metadata, `ais_messages` for the raw stream, and `ais_predictions`, which links each prediction back to its source message.
3. **ETL loop.** Every 30 seconds it pulls the last 30 minutes of messages, drops stale rows and position jumps larger than a set limit, builds motion features and writes new predictions.
4. **Serving.** FastAPI exposes the latest vessel state, the ETL status and the raw data as JSON or CSV. A small Leaflet dashboard shows live markers and the projected tracks.

## Why the simple model stayed

We tested XGBoost against a plain constant-velocity projection. XGBoost was not clearly better, and it would have added retraining, model files and more ways for a live loop to fail. So the deployed predictor is constant velocity, and XGBoost stays in the repository as a comparison. For a system that has to keep running unattended, the simpler model was the right call.

