# syntax=docker/dockerfile:1

# ArcNave run_python sandbox — a single-use Cloud Run Job container. Runs as a non-root user;
# the runtime service account it's deployed with has zero project IAM (see
# docs/decisions/0005-cloud-run-sandbox.md), so this file's own isolation (non-root user, process-
# group timeout kill in runner.py) is the meaningful layer, not "this container can't do damage
# because it has no credentials" alone.

FROM python:3.12-slim

# Install approved native document parsing and rendering utilities in the isolated container
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils pandoc libreoffice-nogui && rm -rf /var/lib/apt/lists/*

# Fixed, build-time-installed package set — matches ADR-0004's parity goal with Claude.ai/
# ChatGPT's own code-execution tools. No pip install happens at request time.
RUN pip install --no-cache-dir pandas numpy matplotlib openpyxl

RUN useradd --create-home --shell /usr/sbin/nologin sandbox
USER sandbox
WORKDIR /home/sandbox

COPY --chown=sandbox:sandbox runner.py /home/sandbox/runner.py

ENTRYPOINT ["python3", "/home/sandbox/runner.py"]
