# Database operations

- `.env.local`, development, tests, builds, and gates use local Postgres, never production Neon. Release secrets: login Keychain service `texttext-release`, accounts `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN`, accessed by `release/secrets.sh`. Missing secrets stop release; no plaintext credentials.
