### How to Read the Code by Hand

Every instruction is exactly 8 bits (0s and 1s) long.

To read an instruction, split it in half. The **first 4 bits** tell the computer what action to take. The **last 4 bits** give the details.

Before you start, you need to know the names of the 4 registers (the computer's temporary memory slots):

* `00` = Register A
* `01` = Register B
* `10` = Register C
* `11` = Register D

Here is how to read every instruction.

---

### Math Operations

**First 4 bits are `0000**`

* **Next 2 bits:** The math type (`00` is +, `01` is -, `10` is *, `11` is /).
* **Last 2 bits:** Always `00` (ignored).
* **Action:** It does the math on Register A and Register B. The answer goes into Register C.

### Compare Registers

**First 4 bits are `0001**`

* **Next 2 bits:** The first register to check.
* **Last 2 bits:** The second register to check.
* **Action:** It compares the two registers. If they are the same, Register A becomes `1`. If they are different, Register A becomes `0`.

### Copy Data

**First 4 bits are `0010**`

* **Next 2 bits:** The register to copy *from*.
* **Last 2 bits:** The register to copy *to*.
* **Action:** It copies the number from the first register into the second register.

### Set Register A to a Number

**First 4 bits are `0011**`

* **Last 4 bits:** A normal number from 0 to 15 (for example, `0101` is 5).
* **Action:** It puts that exact number into Register A.

### Jump to a Row

**First 4 bits are `0100**`

* **Last 4 bits:** Always `0000` (ignored).
* **Action:** It looks at the number inside Register A. It changes the "Next instruction row" to that number.

### Conditional Jump

**First 4 bits are `0101**`

* **Last 4 bits:** Always `0000` (ignored).
* **Action:** It checks Register A. If Register A is exactly `0`, it changes the "Next instruction row" to the number inside Register B. Otherwise, it does nothing.

### Read from Memory

**First 4 bits are `0110**`

* **Next 2 bits:** The register to put the data into.
* **Last 2 bits:** Always `00` (ignored).
* **Action:** It looks at the row number in Register A. It reads the memory from that row, and saves it into your chosen register.

### Write to Memory

**First 4 bits are `0111**`

* **Next 2 bits:** The register holding the data you want to save.
* **Last 2 bits:** Always `00` (ignored).
* **Action:** It looks at the row number in Register A. It takes the value from your chosen register and saves it into that memory row.

### Read User Input

**First 4 bits are `1000**`

* **Next 2 bits:** The register to put the user's number into.
* **Last 2 bits:** Always `00` (ignored).
* **Action:** It waits for the user to type a number, then saves it into your chosen register.

### Print to Screen

**First 4 bits are `1001**`

* **Next 2 bits:** The register holding the number you want to print.
* **Last 2 bits:** Always `00` (ignored).
* **Action:** It prints the value from your chosen register to the screen.

### Stop Program

**First 4 bits are `1111**`

* **Last 4 bits:** Always `0000` (ignored).
* **Action:** The computer stops running the program entirely.