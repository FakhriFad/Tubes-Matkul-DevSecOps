# Jenkins CI/CD Setup Guide

## Architecture

```
GitHub Push → Webhook → Jenkins → Pipeline Stages → Deploy
                                       │
                              ┌────────┴────────┐
                         Unit Tests           SAST
                         Dep Scan             Docker Build
                         DAST                 Stress Smoke
                         Deploy (main only)
```

## Quick Start

### Step 1 — Start Jenkins

```bash
cd ecommerce/
docker compose -f jenkins/docker-compose.jenkins.yml up -d
```

Wait ~60 seconds, then open: **http://localhost:8080**

### Step 2 — Unlock Jenkins

```bash
# Get the initial admin password
docker exec ecom_jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Paste it into the browser, then:
1. Click **Install suggested plugins**
2. Create an admin user
3. Keep the default URL (http://localhost:8080)

### Step 3 — Install additional plugins

Go to **Manage Jenkins → Plugins → Available** and install:
- Docker Pipeline
- SSH Agent
- HTML Publisher
- GitHub Integration
- Timestamper

### Step 4 — Configure Docker access

```bash
# Allow Jenkins to use the host Docker socket
docker exec -u root ecom_jenkins chmod 666 /var/run/docker.sock
```

### Step 5 — Create credentials

Go to **Manage Jenkins → Credentials → Global → Add Credential**:

| ID | Type | Value |
|---|---|---|
| `deploy-ssh-key` | SSH Username with private key | Your deploy server's private key |
| `github-token` | Secret text | Your GitHub personal access token |

### Step 6 — Create the Pipeline job

1. **New Item** → name it `ecomshop` → select **Pipeline**
2. Under **Pipeline**:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - Repository URL: `https://github.com/yourname/ecommerce.git`
   - Credentials: select your GitHub token
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
3. Check **GitHub hook trigger for GITScm polling**
4. Save

### Step 7 — Configure GitHub Webhook

In your GitHub repo → **Settings → Webhooks → Add webhook**:
- Payload URL: `http://YOUR_SERVER_IP:8080/github-webhook/`
- Content type: `application/json`
- Trigger: **Just the push event**
- Secret: (leave empty or set one)

> **Note:** GitHub must be able to reach your Jenkins server. If running locally,
> use [ngrok](https://ngrok.com) to expose it:
> ```bash
> ngrok http 8080
> # Then use the ngrok URL as the webhook payload URL
> ```

### Step 8 — Set environment variables

Go to **Manage Jenkins → System → Global properties → Environment variables**:

| Name | Value |
|---|---|
| `DEPLOY_HOST` | Your production server IP/hostname |
| `DEPLOY_USER` | SSH username for deployment |
| `DEPLOY_PATH` | Absolute path on server (e.g. `/opt/ecommerce`) |

### Step 9 — Test the pipeline

Click **Build Now** on the `ecomshop` job. You should see all 8 stages complete.

---

## Pipeline Stages Explained

### Stage 1: Checkout
Clones the repository, extracts branch name and short commit hash for reporting.

### Stage 2: Unit Tests
Runs all 41 backend unit tests inside a Node.js container.
- Generates test stubs automatically via `tests/create-stubs.js`
- No external dependencies needed
- **Fails build** if any test fails

### Stage 3: SAST
Runs the custom Python SAST scanner (15 security rules, OWASP-mapped).
- Outputs HTML report (viewable in Jenkins → Build → SAST Report)
- **Fails build** if CRITICAL or HIGH findings are detected

### Stage 4: Dependency Scan
Runs `npm audit` on both backend and frontend.
- Checks for known CVEs in dependencies
- Reports HIGH and CRITICAL vulnerabilities

### Stage 5: Docker Build
Builds backend and frontend Docker images in parallel.
- Uses `--parallel` flag for speed
- Generates SSL cert if missing

### Stage 6: Integration & DAST
Starts the full Docker Compose stack, then runs the DAST runner against it.
- Tests 13 security scenarios (auth, injection, headers, RBAC, CORS)
- Outputs HTML report (viewable in Jenkins → Build → DAST Report)

### Stage 7: Stress Test (Smoke)
Runs k6 smoke test (1 VU, 1 minute) against the live stack.
- Verifies all endpoints respond under minimal load
- Full stress tests run on a nightly schedule

### Stage 8: Deploy (main branch only)
SSH deploys to production server when all previous stages pass on `main`.

---

## Nightly Full Stress Test

Create a second Jenkins job for nightly stress:

1. **New Item** → `ecomshop-nightly` → **Pipeline**
2. Trigger: **Build periodically** → `H 2 * * *` (2am daily)
3. Pipeline script:

```groovy
pipeline {
  agent { label 'docker' }
  stages {
    stage('Full Stress Test') {
      steps {
        sh 'make up'
        sh 'make stress-load'
        sh 'make stress-stress'
        sh 'make stress-spike'
      }
      post {
        always { sh 'make down' }
      }
    }
  }
}
```

---

## Troubleshooting

**Jenkins can't run Docker commands:**
```bash
docker exec -u root ecom_jenkins chmod 666 /var/run/docker.sock
```

**GitHub webhook not triggering:**
- Verify Jenkins URL is publicly reachable
- Check webhook delivery log in GitHub Settings → Webhooks

**Build fails at Docker Build stage:**
```bash
# Clear Docker cache on Jenkins agent
docker system prune -f
```

**SSL cert missing in pipeline:**
The pipeline generates it automatically, but if it fails:
```bash
docker exec ecom_jenkins bash -c "cd /workspace/ecomshop && ./nginx/generate-certs.sh"
```
