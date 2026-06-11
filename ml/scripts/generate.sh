#!/bin/bash
# Generates synthetic medical billing data using Synthea.
# Output goes to ml/data/synthea-output/ as CSV files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ML_DIR="$(dirname "$SCRIPT_DIR")"
SYNTHEA_JAR="$ML_DIR/synthea/synthea-with-dependencies.jar"
OUTPUT_DIR="$ML_DIR/data/synthea-output"
PROPS="$ML_DIR/synthea/synthea.properties"

POPULATION="${1:-200}"

if [ ! -f "$SYNTHEA_JAR" ]; then
  echo "ERROR: Synthea JAR not found at $SYNTHEA_JAR"
  echo "Run: curl -L -o $SYNTHEA_JAR https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Generating $POPULATION synthetic patients..."
java -jar "$SYNTHEA_JAR" \
  -p "$POPULATION" \
  --exporter.baseDirectory "$OUTPUT_DIR" \
  -c "$PROPS" \
  Florida Miami

echo ""
echo "Done. Output in: $OUTPUT_DIR/csv/"
echo "Key files:"
ls "$OUTPUT_DIR/csv/" 2>/dev/null | grep -E "claims|encounter|payer|patient" | sed 's/^/  /'
