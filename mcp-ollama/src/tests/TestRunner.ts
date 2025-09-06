export interface TestCase {
  name: string;
  input: any;
  expectedOutput?: any;
  errorMessage?: string;
  language: string;
  category: 'completion' | 'analysis' | 'error_fix' | 'validation';
}

export interface TestResult {
  testName: string;
  passed: boolean;
  actualOutput?: any;
  error?: string;
  executionTime: number;
}

export class TestRunner {
  private testCases: TestCase[] = [];
  private results: TestResult[] = [];

  addTestCase(testCase: TestCase): void {
    this.testCases.push(testCase);
  }

  addTestSuite(category: string): void {
    switch (category) {
      case 'error_fix':
        this.addErrorFixingTests();
        break;
      case 'completion':
        this.addCodeCompletionTests();
        break;
      default:
        throw new Error(`Unsupported test category: ${category}`);
    }
  }

  private addErrorFixingTests(): void {
    this.addTestCase({
      name: 'Fix undefined variable error',
      input: {
        errorMessage: "ReferenceError: myVar is not defined",
        code: "console.log(myVar);",
        language: "javascript"
      },
      language: 'javascript',
      category: 'error_fix'
    });
  }

  private addCodeCompletionTests(): void {
    this.addTestCase({
      name: 'Complete array method',
      input: {
        code: "const arr = [1,2,3]; arr.",
        language: "javascript",
        position: { line: 0, character: 22 }
      },
      language: 'javascript',
      category: 'completion'
    });
  }

  async runTests(mcpServer: any): Promise<TestResult[]> {
    this.results = [];
    
    for (const testCase of this.testCases) {
      const startTime = Date.now();
      let result: TestResult;

      try {
        let actualOutput;
        
        switch (testCase.category) {
          case 'error_fix':
            actualOutput = await mcpServer.handleAutoErrorFix(testCase.input);
            break;
          case 'completion':
            actualOutput = await mcpServer.handleCodeCompletion(testCase.input);
            break;
        }

        const executionTime = Date.now() - startTime;
        const passed = this.validateResult(testCase, actualOutput);

        result = {
          testName: testCase.name,
          passed,
          actualOutput,
          executionTime
        };
      } catch (error) {
        result = {
          testName: testCase.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime
        };
      }

      this.results.push(result);
    }

    return this.results;
  }

  private validateResult(testCase: TestCase, actualOutput: any): boolean {
    switch (testCase.category) {
      case 'error_fix':
        return actualOutput?.fixes?.length > 0 || actualOutput?.recommendedFix;
      case 'completion':
        return actualOutput?.suggestions?.length > 0;
      default:
        return true;
    }
  }

  generateReport(): string {
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const averageTime = totalTests > 0 ? this.results.reduce((sum, r) => sum + r.executionTime, 0) / totalTests : 0;
    const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0.0';

    return `Test Report:
Total Tests: ${totalTests}
Passed: ${passedTests}
Success Rate: ${successRate}%
Average Time: ${averageTime.toFixed(0)}ms`;
  }

  getResults(): TestResult[] {
    return this.results;
  }

  getTestCases(): TestCase[] {
    return this.testCases;
  }
}
