ASK DIGI, AWS DEPLOYMENT PACKAGE

Full instructions: aws/README.md (open it first). Run everything from this deployment/ folder of the cloned repository.

  image/   the portal Docker image (docker load -i image/digiworks-portal.tar.gz)
  aws/     compose file, Caddy config, .env.example, connect-owui.py, README.md

Short version:
  1. Prepare an Ubuntu EC2 server with Docker and git, then git clone the repository.
  2. docker load the image.
  3. cp .env.example .env and fill it in.
  4. docker compose up -d, then run db/bootstrap-tenant.mjs for the first Admin.
  5. python3 connect-owui.py to connect the new Open WebUI.
