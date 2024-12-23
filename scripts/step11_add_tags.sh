#!/bin/bash

# Variables
HTTP_HOST="http://localhost:3004/api/meta/tag-object"  # HTTP host and endpoint
GRPC_HOST="localhost:53004"                              # gRPC host and port
PROTO_FILE_PATH="/tmp/muraxa/storage/storage.proto"        # Destination path for proto file
BUCKET="l1-raw"
OBJECT="test/bmp_13o.mp4"
GLOBAL_ID="1234567890"
TAGS_JSON='[{"name":"tank", "color":"#F865A4", "time": "3.21"}, {"name":"tank", "color":"#F865A4", "time": "4.21"}]'
TAGS_JSON_2='[{"name":"tank", "color":"#F865A4", "time": "3.21"}]'
TAGS_JSON_3='[{"name":"ifv", "color":"#F865B4", "time": "4.21"}]'

# Expected Output for Comparison
EXPECTED_JSON='{
  "id": "test/bmp_13o.mp4",
  "active": true,
  "bucket": "l1-raw",
  "etag": "e2457965fa9567318e4d6e1620d06a4c",
  "name": "test/bmp_13o.mp4",
  "size": 5656456,
  "metadata": {
    "tags": [
      {
        "name": "tank",
        "color": "#F865A4",
        "time": "4.21"
      }
    ]
  }
}'

EXPECTED_JSON_2='{
  "id": "test/bmp_13o.mp4",
  "active": true,
  "bucket": "l1-raw",
  "etag": "e2457965fa9567318e4d6e1620d06a4c",
  "name": "test/bmp_13o.mp4",
  "size": 5656456,
  "metadata": {
    "tags": [
      {
        "name": "tank",
        "color": "#F865A4",
        "time": "3.21"
      },
      {
        "name": "ifv",
        "color": "#F865B4",
        "time": "4.21"
      }
    ]
  }
}'

# Delete metadata.targets field from the MongoDB record
echo "Deleting metadata.targets from MongoDB record..."
mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  db.getCollection("storage.l1-raw.objects").updateOne(
    { id: "test/bmp_13o.mp4" },
    { $unset: { "metadata.tags": [] } }
  );
  print("metadata.tags field deleted from object test/bmp_13o.mp4");
'

# HTTP Test #1 - No metadata, new tags, duplicated entries
echo "Test #1 - No metadata, new tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "tags": '"$TAGS_JSON"'
  }')

# HTTP Test #2 - Duplicated tags
echo "Test #2 - No metadata, new tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "tags": '"$TAGS_JSON"'
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

# HTTP Test #3 - Rewrite tags
echo "Test #3 - Rewrite tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "tags": '"$TAGS_JSON_2"'
  }')  

# HTTP Test #4 - Add new tags
echo "Test #4 - Add new tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "tags": '"$TAGS_JSON_3"'
  }')    

# Filter HTTP response to exclude _id, __v, lastModified
FILTERED_HTTP_RESPONSE=$(echo "$HTTP_RESPONSE" | jq 'del(._id, .__v, .lastModified)')

# Compare with expected JSON
echo "Filtered HTTP Response:"
echo "$FILTERED_HTTP_RESPONSE"
echo ""

if echo "$FILTERED_HTTP_RESPONSE" | jq --argjson expected "$EXPECTED_JSON_2" -e 'if . == $expected then true else false end' > /dev/null; then
  echo "HTTP response matches expected output!"
else
  echo "HTTP response does NOT match expected output!"
  exit 1
fi

# MongoDB Verification
echo "Verifying MongoDB record..."

# Fetch MongoDB record and ensure it's output as valid JSON
MONGODB_RECORD=$(mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  JSON.stringify(db.getCollection("storage.l1-raw.objects").findOne({ id: "test/bmp_13o.mp4" }))
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