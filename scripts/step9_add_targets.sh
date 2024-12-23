#!/bin/bash

# Variables
HTTP_HOST="http://localhost:3004/api/meta/update-target"  # HTTP host and endpoint
GRPC_HOST="localhost:53004"                              # gRPC host and port
PROTO_FILE_PATH="/tmp/muraxa/storage/storage.proto"        # Destination path for proto file
BUCKET="l1-raw"
OBJECT="test/bmp_13m.mp4"
GLOBAL_ID="1234567890"
SELECTIONS_JSON='{"cvatTaskId":"1"}'
GLOBAL_ID_2="1234567891"
SELECTIONS_JSON_2='{"cvatTaskId":"2"}'

# Expected Output for Comparison
EXPECTED_JSON='{
  "id": "test/bmp_13m.mp4",
  "active": true,
  "bucket": "l1-raw",
  "etag": "c851844bfe74d9da418cc21bf2b0edd4",
  "name": "test/bmp_13m.mp4",
  "size": 2099183,
  "metadata": {
    "targets": [
      {
        "globalId": "1234567890",
        "selections": { "cvatTaskId": "1" }
      }
    ]
  }
}'

EXPECTED_JSON_2='{
  "id": "test/bmp_13m.mp4",
  "active": true,
  "bucket": "l1-raw",
  "etag": "c851844bfe74d9da418cc21bf2b0edd4",
  "name": "test/bmp_13m.mp4",
  "size": 2099183,
  "metadata": {
    "targets": [
      {
        "globalId": "1234567890",
        "selections": { "cvatTaskId": "1" }
      },
      {
        "globalId": "1234567891",
        "selections": { "cvatTaskId": "2" }
      }
    ]
  }
}'

# Check if the directory exists
if [ ! -d "/tmp/muraxa/storage" ]; then
  echo "Directory /tmp/muraxa/storage does not exist. Creating it..."
  mkdir -p /tmp/muraxa/storage
  if [ $? -ne 0 ]; then
    echo "Failed to create directory /tmp/muraxa/storage!"
    exit 1
  else
    echo "Directory /tmp/muraxa/storage created successfully."
  fi
else
  echo "Directory /tmp/muraxa/storage already exists."
fi

# Download the proto file using curl to the /tmp/muraxa/storage directory
echo "Downloading proto file..."
curl -s -o "$PROTO_FILE_PATH" "http://localhost:3004/api/meta/download-proto"

if [ $? -ne 0 ]; then
  echo "Failed to download proto file!"
  exit 1
else
  echo "Proto file downloaded successfully to $PROTO_FILE_PATH"
fi

# Delete metadata.targets field from the MongoDB record
echo "Deleting metadata.targets from MongoDB record..."
mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  db.getCollection("storage.l1-raw.objects").updateOne(
    { id: "test/bmp_13m.mp4" },
    { $unset: { "metadata.targets": [] } }
  );
  print("metadata.targets field deleted from object test/bmp_13m.mp4");
'

# HTTP Test
echo "Testing HTTP method..."
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "target": {
      "globalId": "'"$GLOBAL_ID"'",
      "selections": '"$SELECTIONS_JSON"'
    }
  }')

# Filter HTTP response to exclude _id, __v, lastModified
FILTERED_HTTP_RESPONSE=$(echo "$HTTP_RESPONSE" | jq 'del(._id, .__v, .lastModified)')

# Compare with expected JSON
echo "Filtered HTTP Response:"
echo "$FILTERED_HTTP_RESPONSE"
echo ""

if echo "$FILTERED_HTTP_RESPONSE" | jq --argjson expected "$EXPECTED_JSON" -e 'if . == $expected then true else false end' > /dev/null; then
  echo "HTTP response matches expected output!"
else
  echo "HTTP response does NOT match expected output!"
  exit 1
fi

# gRPC Test
echo "Testing gRPC method..."
GRPC_RESPONSE=$(grpcurl -plaintext -import-path /tmp/muraxa/storage -proto "$PROTO_FILE_PATH" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "target": {
      "globalId": "'"$GLOBAL_ID_2"'",
      "selections": '"$SELECTIONS_JSON_2"'
    }
  }' "$GRPC_HOST" storage.MetaService/UpdateTarget)

echo "gRPC Response:"
echo "$GRPC_RESPONSE"
echo ""

# MongoDB Verification
echo "Verifying MongoDB record..."

# Fetch MongoDB record and ensure it's output as valid JSON
MONGODB_RECORD=$(mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  JSON.stringify(db.getCollection("storage.l1-raw.objects").findOne({ id: "test/bmp_13m.mp4" }))
')

# Filter MongoDB record to exclude _id, __v, lastModified using jq
FILTERED_MONGODB_RECORD=$(echo "$MONGODB_RECORD" | jq 'del(._id, .__v, .lastModified)')

echo "Filtered MongoDB Record:"
echo "$FILTERED_MONGODB_RECORD"
echo ""

# Compare MongoDB record with expected JSON
if echo "$FILTERED_MONGODB_RECORD" | jq --argjson expected "$EXPECTED_JSON_2" -e 'if . == $expected then true else false end' > /dev/null; then
  echo "MongoDB record matches expected output!"
else
  echo "MongoDB record does NOT match expected output!"
  exit 1
fi