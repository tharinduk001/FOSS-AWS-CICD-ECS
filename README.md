# AWS CI/CD Pipeline Guide
### GitHub → CodePipeline → CodeBuild → ECR → ECS Fargate

> A complete step-by-step guide to building a fully automated Docker deployment pipeline on AWS — from writing code to running containers.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Phase 1 — Prepare Your Application](#phase-1--prepare-your-application)
4. [Phase 2 — Push Code to GitHub](#phase-2--push-code-to-github)
5. [Phase 3 — Create ECR Private Repository](#phase-3--create-ecr-private-repository)
6. [Phase 4 — Create ECS Cluster](#phase-4--create-ecs-cluster)
7. [Phase 5 — Create Task Definition](#phase-5--create-task-definition)
8. [Phase 6 — Create ECS Service](#phase-6--create-ecs-service)
9. [Phase 7 — Set Up IAM Roles](#phase-7--set-up-iam-roles)
10. [Phase 8 — Create CodeBuild Project](#phase-8--create-codebuild-project)
11. [Phase 9 — Create CodePipeline](#phase-9--create-codepipeline)
12. [Phase 10 — Test the Pipeline](#phase-10--test-the-pipeline)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
You push code to GitHub
        ↓
  AWS CodePipeline  (detects the push via webhook)
        ↓
  AWS CodeBuild     (builds Docker image using buildspec.yml)
        ↓
  AWS ECR           (stores the Docker image privately)
        ↓
  AWS ECS Fargate   (pulls & runs the updated container)
```

### Services Used

| Service | Purpose |
|---------|---------|
| **GitHub** | Source code repository |
| **AWS CodePipeline** | Orchestrates the entire CI/CD workflow |
| **AWS CodeBuild** | Builds the Docker image |
| **AWS ECR** | Private Docker image registry |
| **AWS ECS Fargate** | Serverless container runtime |
| **AWS IAM** | Permissions and roles |

---

## Prerequisites

Before starting, make sure you have:

- An **AWS Account** (Free Tier works)
- A **GitHub Account**
- **Docker Desktop** installed locally
- **Git** installed
- **VS Code** or any code editor

---

## Phase 1 — Prepare Your Application

### Step 1.1 — Create Project Folder

```bash
mkdir my-aws-demo
cd my-aws-demo
```

### Step 1.2 — Create `app.js`

```javascript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('<h1>🚀 Hello from ECS! Pipeline is working!</h1>');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Step 1.3 — Create `package.json`

```json
{
  "name": "my-aws-demo",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

### Step 1.4 — Create `Dockerfile`

> ⚠️ **Important:** Use the **ECR Public mirror** instead of Docker Hub to avoid rate limit errors in CodeBuild.

```dockerfile
# Use ECR Public mirror instead of Docker Hub (avoids rate limit errors in CodeBuild)
FROM public.ecr.aws/docker/library/node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (for layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the code
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
```

**Why `public.ecr.aws` instead of `node:18-alpine`?**

Docker Hub has a rate limit for unauthenticated pulls. AWS CodeBuild uses shared IPs that frequently hit this limit, causing a `429 Too Many Requests` error. Using the AWS ECR Public mirror avoids this entirely.

### Step 1.5 — Create `buildspec.yml`

This file tells CodeBuild exactly what commands to run.

```yaml
version: 0.2

phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME
      - IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)

  build:
    commands:
      - echo Building the Docker image...
      - docker build -t $REPOSITORY_URI:latest .
      - docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG

  post_build:
    commands:
      - echo Pushing the Docker image to ECR...
      - docker push $REPOSITORY_URI:latest
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - echo Writing image definitions file...
      - printf '[{"name":"my-app-container","imageUri":"%s"}]' $REPOSITORY_URI:latest > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
```

> ⭐ The `imagedefinitions.json` file is critical — it tells ECS which container to update during deployment.

### Step 1.6 — Create `.gitignore`

```
node_modules/
.env
```

### Final Project Structure

```
my-aws-demo/
├── app.js
├── package.json
├── Dockerfile
├── buildspec.yml
└── .gitignore
```

---

## Phase 2 — Push Code to GitHub

```bash
# Initialize git
git init

# Add all files
git add .

# First commit
git commit -m "Initial commit - AWS demo app"
```

Then on GitHub:

1. Go to **github.com** → Click **New Repository**
2. Name it `my-aws-demo`
3. Keep it **Public** or **Private** (both work)
4. Click **Create repository**
5. Push your code:

```bash
git remote add origin https://github.com/YOUR_USERNAME/my-aws-demo.git
git branch -M main
git push -u origin main
```

✅ Your code is now on GitHub.

---

## Phase 3 — Create ECR Private Repository

1. Go to **AWS Console** → Search **ECR** → Click **Elastic Container Registry**
2. Click **Create repository**
3. Configure:
   - Visibility: **Private**
   - Repository name: `my-app-repo`
4. Click **Create repository**

> 📝 **Save your Repository URI** — it looks like:
> `123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app-repo`
> You'll need this in later steps.

---

## Phase 4 — Create ECS Cluster

1. Go to **AWS Console** → Search **ECS** → Click **Elastic Container Service**
2. Click **Clusters** → **Create Cluster**
3. Configure:
   - Cluster name: `my-app-cluster`
   - Infrastructure: ✅ **AWS Fargate** (serverless — no EC2 instances to manage)
4. Click **Create**

> ⏳ Wait about 1 minute for the cluster to be ready.

---

## Phase 5 — Create Task Definition

A Task Definition tells ECS **what container to run** and how to run it.

1. In ECS → Click **Task Definitions** → **Create new task definition**
2. Configure:
   - Task definition family: `my-app-task`
   - Launch type: **AWS Fargate**
   - CPU: `0.5 vCPU`
   - Memory: `1 GB`
3. Under **Container details**:
   - Name: `my-app-container`
   
     > ⭐ This name **must exactly match** the container name in `buildspec.yml`
   - Image URI: `YOUR_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/my-app-repo:latest`
   - Container port: `3000`
   - Protocol: `TCP`
4. Click **Create**

---

## Phase 6 — Create ECS Service

An ECS Service keeps your container **running continuously** and handles rolling deployments.

1. In ECS → Click your cluster `my-app-cluster`
2. Click **Services** tab → **Create**
3. Configure:
   - Launch type: **Fargate**
   - Task definition: `my-app-task` (latest revision)
   - Service name: `my-app-service`
   - Desired tasks: `1`
4. Under **Networking**:
   - VPC: Select the **default VPC**
   - Subnets: Select at least **2 subnets**
   - Security group: Create new
     - Allow inbound **TCP port 3000** from **Anywhere (0.0.0.0/0)**
   - Public IP: **Enabled**
5. Click **Create**

---

## Phase 7 — Set Up IAM Roles

This is the most critical phase — it gives AWS services permission to talk to each other.

### Role 1: CodeBuild Role

**Create the role:**

1. Go to **IAM** → **Roles** → **Create role**
2. Trusted entity type: **AWS Service**
3. Use case: Search for **CodeBuild** → Select it
4. Click **Next**

**Attach these policies:**

| Policy | Purpose |
|--------|---------|
| `AmazonEC2ContainerRegistryFullAccess` | Push images to ECR |
| `AmazonECS_FullAccess` | Access ECS |
| `AWSCodeBuildAdminAccess` | CodeBuild permissions |
| `CloudWatchLogsFullAccess` | View build logs |

5. Role name: `CodeBuildECRRole`
6. Click **Create role**

---

### Role 2: CodePipeline Role

> ⚠️ **Note:** CodePipeline does not appear in the AWS Service dropdown. Use the **Custom trust policy** method instead.

**Create the role:**

1. Go to **IAM** → **Roles** → **Create role**
2. Trusted entity type: **Custom trust policy**
3. Paste this JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "codepipeline.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

4. Click **Next**
5. Skip the managed policies — click **Next** again
6. Role name: `CodePipelineECSRole`
7. Click **Create role**

**Now add the Inline Policy (`CodePipelineCustomPolicy`):**

> ℹ️ We use an inline policy instead of managed policies because AWS has deprecated `AWSCodePipelineFullAccess` and the newer managed policies may not be available in all accounts/regions. An inline policy is simpler and always works.

1. Open the newly created `CodePipelineECSRole`
2. Click **Add permissions** → **Create inline policy**
3. Switch to the **JSON** tab
4. Paste this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codepipeline:*",
        "codebuild:*",
        "ecs:*",
        "s3:*",
        "iam:PassRole",
        "ecr:*",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

5. Click **Next**
6. Policy name: `CodePipelineCustomPolicy`
7. Click **Create policy**

✅ `CodePipelineECSRole` now has `CodePipelineCustomPolicy` attached as an inline policy.

---

## Phase 8 — Create CodeBuild Project

1. Go to **AWS Console** → Search **CodeBuild** → **Create build project**
2. Configure:
   - Project name: `my-app-build`

**Source:**
- Source provider: **GitHub**
- Click **Connect to GitHub** → Authorize AWS
- Select your repository `my-aws-demo`

**Environment:**
- Environment: **Managed image**
- Operating system: **Ubuntu**
- Runtime: **Standard**
- Image: `aws/codebuild/standard:7.0`
- ✅ **Enable privileged mode** ← Required for Docker builds!
- Service role: `CodeBuildECRRole`

**Environment Variables — Add all three:**

| Name | Value |
|------|-------|
| `AWS_DEFAULT_REGION` | Your region (e.g. `us-east-1`) |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |
| `IMAGE_REPO_NAME` | `my-app-repo` |

**Buildspec:**
- Select: **Use a buildspec file**
- Leave filename blank (defaults to `buildspec.yml` in your repo root)

3. Click **Create build project**

---

## Phase 9 — Create CodePipeline

1. Go to **AWS Console** → Search **CodePipeline** → **Create pipeline**
2. On the "Choose creation option" screen:
   - Category: **Build custom pipeline**
   
     > ⭐ Do NOT use the templates (Push to ECR, Deploy to ECS Fargate, etc.) — they only cover partial workflows. "Build custom pipeline" lets us add all 3 stages manually.

3. Configure:
   - Pipeline name: `my-app-pipeline`
   - Execution mode: **Superseded**
   - Service role: Select `CodePipelineECSRole`
4. Click **Next**

### Stage 1 — Source

- Source provider: **GitHub (Version 2)**
- Click **Connect to GitHub** → Follow OAuth flow to authorize
- Repository name: `YOUR_USERNAME/my-aws-demo`
- Branch: `main`
- Detection mode: **Webhooks** (auto-triggers on push)
- Click **Next**

### Stage 2 — Build

- Build provider: **AWS CodeBuild**
- Region: Your region
- Project name: `my-app-build`
- Click **Next**

### Stage 3 — Deploy

- Deploy provider: **Amazon ECS**
- Region: Your region
- Cluster name: `my-app-cluster`
- Service name: `my-app-service`
- Image definitions file: `imagedefinitions.json`
- Click **Next**

5. Review everything → Click **Create pipeline**

> ⏳ The pipeline will run automatically for the first time after creation.

---

## Phase 10 — Test the Pipeline

### Trigger the pipeline manually:

```bash
# Make a visible change to your app
# Edit app.js and change the message:
# '<h1>🚀 Hello from ECS! Version 2 is live!</h1>'

git add .
git commit -m "Test pipeline - version 2"
git push origin main
```

### Watch the pipeline execute:

1. Go to **CodePipeline** → `my-app-pipeline`
2. Watch all 3 stages turn green:

```
✅ Source   → GitHub push detected
✅ Build    → Docker image built and pushed to ECR
✅ Deploy   → ECS updated with new image
```

### Access your running app:

1. Go to **ECS** → `my-app-cluster` → `my-app-service`
2. Click the **Tasks** tab → Click the running task
3. Find the **Public IP** address
4. Open `http://PUBLIC_IP:3000` in your browser 🎉

---

## Troubleshooting

### ❌ Error: `429 Too Many Requests` from Docker Hub

**Cause:** CodeBuild hit Docker Hub's anonymous pull rate limit.

**Fix:** Change your `Dockerfile` FROM line:

```dockerfile
# ❌ Old (causes rate limit errors)
FROM node:18-alpine

# ✅ New (use ECR Public mirror — no rate limits)
FROM public.ecr.aws/docker/library/node:18-alpine
```

Commit and push — the pipeline will re-trigger automatically.

---

### ❌ CodePipeline not in IAM dropdown

**Cause:** AWS removed CodePipeline from the service dropdown in newer UI.

**Fix:** Use **Custom trust policy** when creating the role (see Phase 7 — Role 2) and paste this JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "codepipeline.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Then attach the `CodePipelineCustomPolicy` inline policy as described in Phase 7.

---

### ❌ Managed pipeline policies not found in IAM

**Cause:** AWS has deprecated `AWSCodePipelineFullAccess` and newer managed policies like `AWSCodePipeline_FullAccess` may not appear in all accounts or regions.

**Fix:** Always use the `CodePipelineCustomPolicy` inline policy approach described in Phase 7 — it works regardless of AWS UI changes or region restrictions.

---

### ❌ ECS task keeps stopping / failing to start

**Cause:** Usually a port mismatch or missing IAM permissions.

**Fix checklist:**
- Container port in Task Definition matches the port in your app (`3000`)
- Security group allows inbound traffic on port `3000`
- ECR image URI in Task Definition is correct
- ECS Task Execution Role has `AmazonECSTaskExecutionRolePolicy` attached

---

### ❌ `imagedefinitions.json` not found during deploy

**Cause:** The `buildspec.yml` `post_build` phase failed before creating the file, or the artifacts section is missing.

**Fix:** Make sure your `buildspec.yml` has this in the `post_build` section and the `artifacts` section:

```yaml
post_build:
  commands:
    - printf '[{"name":"my-app-container","imageUri":"%s"}]' $REPOSITORY_URI:latest > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
```

Also verify the container name (`my-app-container`) matches exactly in both `buildspec.yml` and the ECS Task Definition.

---

## Full Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Developer Machine                    │
│                                                         │
│   code → git commit → git push                         │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS push
                           ▼
┌──────────────────────────────────────────────────────────┐
│                        GitHub                            │
│                   Repository: main branch                │
└──────────────────────────┬───────────────────────────────┘
                           │ Webhook trigger
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    AWS CodePipeline                       │
│                                                          │
│  Stage 1: Source ──► Stage 2: Build ──► Stage 3: Deploy │
└──────────┬──────────────────┬───────────────────┬────────┘
           │                  │                   │
           ▼                  ▼                   ▼
      GitHub repo        CodeBuild           ECS Service
      (artifact)     (builds & pushes)     (rolling deploy)
                           │
                           ▼
                    ┌─────────────┐
                    │  AWS ECR    │
                    │ (image      │
                    │  registry)  │
                    └──────┬──────┘
                           │ pull image
                           ▼
                    ┌─────────────┐
                    │ ECS Fargate │
                    │  (running   │
                    │  container) │
                    └─────────────┘
                           │
                           ▼
                    http://PUBLIC_IP:3000
```

---

## Quick Reference Cheat Sheet

| Resource | Name Used |
|----------|-----------|
| ECR Repository | `my-app-repo` |
| ECS Cluster | `my-app-cluster` |
| ECS Task Definition | `my-app-task` |
| ECS Service | `my-app-service` |
| Container Name | `my-app-container` |
| CodeBuild Project | `my-app-build` |
| CodePipeline | `my-app-pipeline` |
| CodeBuild IAM Role | `CodeBuildECRRole` |
| CodePipeline IAM Role | `CodePipelineECSRole` |
| CodePipeline Inline Policy | `CodePipelineCustomPolicy` |

> ⭐ **Golden Rule:** The container name `my-app-container` must be identical in three places: Task Definition, `buildspec.yml`, and `imagedefinitions.json` output.

---

*Guide covers AWS Console UI as of May 2026. Some UI screens may vary slightly across regions.*
