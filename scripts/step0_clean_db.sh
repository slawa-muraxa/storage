#!/bin/bash

# MongoDB connection details
MONGO_HOST="localhost"
MONGO_PORT="37017"
DB_NAME="storage"

# MinIO bucket name
MINIO_BUCKET="l1-raw"

# MinIO alias name (configured via mc alias set)
MINIO_ALIAS="myminio"

# Connect to MongoDB and delete all collections
echo "Connecting to MongoDB at $MONGO_HOST:$MONGO_PORT..."

# Use mongosh to list all collections and delete them
mongosh "mongodb://$MONGO_HOST:$MONGO_PORT/$DB_NAME" --eval "
  const collections = db.getCollectionNames();
  collections.forEach(function(collection) {
    print('Dropping collection: ' + collection);
    db[collection].drop();
  });
"

# Delete all objects in the l1-raw bucket
echo "Deleting all objects in MinIO bucket: $MINIO_BUCKET..."
mc rm --recursive --force "$MINIO_ALIAS/$MINIO_BUCKET"

echo "Cleanup completed."