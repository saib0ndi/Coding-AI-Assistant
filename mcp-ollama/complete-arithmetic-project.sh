#!/bin/bash

# Create directory 'arithmetic-operations'
mkdir -p arithmetic-operations

# Navigate into the newly created directory
cd arithmetic-operations || exit 1

# Create files for each arithmetic operation
touch addition.md subtraction.md multiplication.md division.md

# Add content to each file
echo "# Addition" > addition.md
echo "## Definition" >> addition.md
echo "Addition is a fundamental mathematical operation that combines two or more numbers to produce their sum." >> addition.md
echo "" >> addition.md
echo "## Examples" >> addition.md
echo "- 2 + 3 = 5" >> addition.md
echo "- 4 + 0 = 4" >> addition.md
echo "" >> addition.md
echo "## Properties" >> addition.md
echo "- Commutative: a + b = b + a" >> addition.md
echo "- Associative: (a + b) + c = a + (b + c)" >> addition.md

echo "# Subtraction" > subtraction.md
echo "## Definition" >> subtraction.md
echo "Subtraction is the inverse operation of addition, where one number is reduced by another." >> subtraction.md
echo "" >> subtraction.md
echo "## Examples" >> subtraction.md
echo "- 5 - 3 = 2" >> subtraction.md
echo "- 10 - 0 = 10" >> subtraction.md
echo "" >> subtraction.md
echo "## Properties" >> subtraction.md
echo "- Commutative: a - b ≠ b - a" >> subtraction.md
echo "- Associative: (a - b) - c ≠ a - (b - c)" >> subtraction.md

echo "# Multiplication" > multiplication.md
echo "## Definition" >> multiplication.md
echo "Multiplication is the operation of repeated addition, where one number is added to itself as many times as another number specifies." >> multiplication.md
echo "" >> multiplication.md
echo "## Examples" >> multiplication.md
echo "- 4 × 5 = 20" >> multiplication.md
echo "- 0 × 3 = 0" >> multiplication.md
echo "" >> multiplication.md
echo "## Properties" >> multiplication.md
echo "- Commutative: a × b = b × a" >> multiplication.md
echo "- Associative: (a × b) × c = a × (b × c)" >> multiplication.md

echo "# Division" > division.md
echo "## Definition" >> division.md
echo "Division is the operation of repeated subtraction, where one number is subtracted from another as many times as possible." >> division.md
echo "" >> division.md
echo "## Examples" >> division.md
echo "- 10 ÷ 2 = 5" >> division.md
echo "- 0 ÷ 3 = 0" >> division.md
echo "" >> division.md
echo "## Properties" >> division.md
echo "- Commutative: a ÷ b ≠ b ÷ a" >> division.md
echo "- Associative: (a ÷ b) ÷ c ≠ a ÷ (b ÷ c)" >> division.md

# Make the script executable and ready to run
chmod +x arithmetic-operations.sh