FROM digiworks-portal:release
# Settings > Users: Reset password asks first, is not offered on your own row, and the server refuses a self-reset (QA DEF-27); see README.md
COPY --chown=100:101 files/ /app/
