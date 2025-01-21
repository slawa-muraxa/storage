#!/bin/bash

# Variables
HTTP_HOST="http://localhost:3004/api/meta/update-attributes"  # HTTP host and endpoint
BUCKET="l1-raw"
OBJECT="test/bmp_13o.mp4"
ATTRIB_JSON='[{"name":"weather", "value": "sunny"}, {"name":"brigade", "value":80}]'
ATTRIB_JSON_2='[{"name":"weather", "value": "cloudy"}, {"name":"brigade", "value":80}, {"name":"quality", "value":"clean"}]'

# Expected Output for Comparison
EXPECTED_JSON='[{"name":"weather", "value": "sunny"}, {"name":"brigade", "value":80}]'
EXPECTED_JSON_2='[{"name":"weather", "value": "cloudy"}, {"name":"brigade", "value":80}, {"name":"quality", "value":"clean"}]'

# Delete metadata.targets field from the MongoDB record
echo "Deleting metadata.targets from MongoDB record..."
mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  db.getCollection("storage.l1-raw.objects").updateOne(
    { id: "test/bmp_13o.mp4" },
    { $unset: { "metadata.attributes": [] } }
  );
  print("metadata.attributes field deleted from object test/bmp_13o.mp4");
'

# HTTP Test #1 - No metadata, new tags, duplicated entries
echo "Test #1 - No metadata, new tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "attributes": '"$ATTRIB_JSON"'
  }')

# HTTP Test #2 - Duplicated tags
echo "Test #2 - No metadata, new tags"
HTTP_RESPONSE=$(curl -s -X POST "$HTTP_HOST" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "'"$BUCKET"'",
    "objectName": "'"$OBJECT"'",
    "attributes": '"$ATTRIB_JSON"'
  }')  

# Filter HTTP response to exclude _id, __v, lastModified
FILTERED_HTTP_RESPONSE=$(echo "$HTTP_RESPONSE" | jq 'del(._id, .__v, .lastModified)')

# Compare with expected JSON
echo "Filtered HTTP Response:"
echo -e "Response:\n$(echo "$FILTERED_HTTP_RESPONSE" | jq --color-output '.')"
echo ""

metadata=$(echo "$FILTERED_HTTP_RESPONSE" | jq '.metadata.attributes')

if echo "$metadata" | jq --argjson expected "$EXPECTED_JSON" -e 'if . == $expected then true else false end' > /dev/null; then
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
    "attributes": '"$ATTRIB_JSON_2"'
  }')  

# Filter HTTP response to exclude _id, __v, lastModified
FILTERED_HTTP_RESPONSE=$(echo "$HTTP_RESPONSE" | jq 'del(._id, .__v, .lastModified)')

# Compare with expected JSON
echo "Filtered HTTP Response:"
echo -e "Response:\n$(echo "$FILTERED_HTTP_RESPONSE" | jq --color-output '.')"
echo ""

metadata=$(echo "$FILTERED_HTTP_RESPONSE" | jq '.metadata.attributes')

if echo "$metadata" | jq --argjson expected "$EXPECTED_JSON_2" -e 'if . == $expected then true else false end' > /dev/null; then
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
echo -e "Response:\n$(echo "$FILTERED_MONGODB_RECORD" | jq --color-output '.')"
echo ""

metadata=$(echo "$FILTERED_MONGODB_RECORD" | jq '.metadata.attributes')

# Compare MongoDB record with expected JSON
if echo "$metadata" | jq --argjson expected "$EXPECTED_JSON_2" -e 'if . == $expected then true else false end' > /dev/null; then
  echo "MongoDB record matches expected output!"
else
  echo "MongoDB record does NOT match expected output!"
  exit 1
fi