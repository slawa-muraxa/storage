#!/bin/bash

# MongoDB connection details
MONGO_HOST="localhost"
MONGO_PORT="37017"
DB_NAME="storage"

# MinIO bucket names
MINIO_BUCKETS=("l1-raw" "l1-preview" "l3-rel")

# MinIO alias name (configured via mc alias set)
MINIO_ALIAS="myminio"

# Connect to MongoDB and delete all collections
echo "Connecting to MongoDB at $MONGO_HOST:$MONGO_PORT..."

mongosh "mongodb://$MONGO_HOST:$MONGO_PORT/$DB_NAME" --quiet --eval "
  const collections = db.getCollectionNames();
  collections.forEach(collection => {
    print('Dropping collection: ' + collection);
    db[collection].drop();
  });
"

# Delete all objects in MinIO buckets
for BUCKET in "${MINIO_BUCKETS[@]}"; do
  echo "Deleting all objects in MinIO bucket: $BUCKET..."
  mc rm --recursive --force "$MINIO_ALIAS/$BUCKET"
done

echo "Cleanup completed."