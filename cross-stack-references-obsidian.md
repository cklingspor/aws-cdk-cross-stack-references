# Cross-Stack References in AWS CDK

Cross-stack references are one of the most common pain points when working with AWS CDK and CloudFormation. They seem convenient for sharing resources between stacks but they create tight coupling that can block infrastructure changes.

## TL/DR Solution

- **Solution 1**: Configuration-based dependency pattern: Pass only configuration values (e.g.: strings) and have each stack independently import the resource.
- **Solution 2**: For existing infra use a two-phase migration pattern with the use of dummy exports

> [!tip] Best Practice
> Try to avoid cross stack reference where possible. The application stack pattern helps already.

## Problem Statement

When you pass a resource from one CDK stack to another, the CDK automatically creates CloudFormation exports and imports. While this seems elegant, it introduces a fundamental constraint: **CloudFormation prevents you from modifying or deleting any exported value while it's being imported by another stack.**

This is how it could look in practice

```typescript
// Stack 1: Creates a DynamoDB table
export class UserServiceStack extends Stack {
  public readonly usersTable: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.usersTable = new dynamodb.TableV2(this, 'UsersTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      tableName: 'Users'
    });
  }
}

// Stack 2: References the table from Stack 1
interface OrderServiceStackProps extends StackProps {
  usersTable: dynamodb.ITableV2;
}

export class OrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderServiceStackProps) {
    super(scope, id, props);

    const readUser = new NodejsFunction(this, "OrderFunction", {
      entry: "./lib/lambdas/handler.ts",
      environment: {
        USER_TABLE_NAME: props.usersTable.tableName,
      },
    });

    props.usersTable.grantReadData(readUser);
  }
}

// App: Wire stacks together
const userServiceStack = new UserServiceStack(app, "UserService");
new OrderServiceStack(app, "OrderService", {
  usersTable: userServiceStack.usersTable,
});
```

Behind the scenes, the CDK generates CloudFormation templates with exports and imports:

```json
# Partial UserService stack
{
  "ExportsOutputRefUsersTable9725E9C857961836": {
    "Value": {
      "Ref": "UsersTable9725E9C8"
    },
    "Export": {
      "Name": "UserService:ExportsOutputRefUsersTable9725E9C857961836"
    }

  }
}

# Partial OrderService stack
{
  "Resources": {
    "OrderFunction": {
        "Properties": {
          "Environment": {
            "USER_TABLE": {
              "Fn::ImportValue": "UserService:ExportsOutputRefUsersTable"
              }
          }
        }
      }
  }
}
```

Note the `"Fn::ImportValue"`. This line is enforcing the CloudFormation dependency.

### When does this become a problem?

> [!info]
> The following errors can only be observed when running the deployment against a deployed CloudFormation stack. A `cdk diff` does not surface this error message.

#### 1. Modifying the Exported Resource

Suppose your Users table gets corrupted and you need to restore from a backup with a new table name:

```typescript
this.usersTable = new dynamodb.TableV2(this, 'UsersTable', {
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  tableName: 'UsersBackup' // Changed from 'Users'
});
```

The deployment now fails with:

```
Export UserService:ExportsOutputRefUsersTable... cannot be updated as it is in use by OrderService
```

#### 2. Deleting the Producing Stack

You decide to refactor and move the table to a different stack. You also remove the Table from the `OrderService`. The deletion fails with:
```
Export UserService:ExportsOutputRefUsersTable... cannot be deleted as it is in use by OrderService
```

What happens under the hood:

- The `UserService` stack tries to remove the export (since it's no longer referenced in code) or is being removed itself.
- CloudFormation blocks the removal because `OrderService` still imports a property from the `UserService`.
- The `OrderService` stack hasn't deployed yet to remove its import
- Circular dependency deadlock

## Solution 1: Configuration-Based Dependencies

Instead of passing actual resource objects between stacks, pass only configuration values (e.g.: strings) and have each stack independently import the resource.

> [!success] Recommendation
> Use this even though it has some drawbacks. See after code excerpts.

### Implementation

```typescript
// Stack 1: Export nothing, just create the table
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AttributeType, ITableV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { StackProps } from "aws-cdk-lib";

interface UserServiceStackProps extends StackProps {
  usersTableName: string;
}

export class ConfigBasedUserServiceStack extends cdk.Stack {
  public readonly usersTable: ITableV2;

  constructor(scope: Construct, id: string, props: UserServiceStackProps) {
    super(scope, id, props);

    this.usersTable = new TableV2(this, "UsersTable", {
      tableName: props.usersTableName,
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
    });
  }
}

// Stack 2: Import via configuration, not cross-stack reference
import * as cdk from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

interface OrderServiceStackProps extends cdk.StackProps {
  usersTableName: string;
}

export class ConfigBasedOrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderServiceStackProps) {
    super(scope, id, props);

    const usersTable = TableV2.fromTableAttributes(this, "ImportedUsersTable", {
      tableName: props.usersTableName,
      globalIndexes: [], // Add indexes if needed for grants
    });

    const readUser = new NodejsFunction(this, "OrderFunction", {
      entry: "./lib/lambdas/handler.ts",
      environment: {
        USER_TABLE_NAME: props.usersTableName,
      },
    });

    usersTable.grantReadData(readUser);
  }
}


// App: Pass configuration strings, not resources
const app = new App();

const usersTableName = 'Users';
const tableName = "Users";
new ConfigBasedUserServiceStack(app, "ConfigBasedUserService", {
  usersTableName: tableName,
});
new ConfigBasedOrderServiceStack(app, "ConfigBasedOrderService", {
  usersTableName: tableName,
});
```

### Drawbacks

- Passing strings instead of typed constructs
- Imported resources have limitations (e.g., grants may not work without additional information like indexes)
- You must ensure configuration values match actual resource names

## Solution 2: The Two-Phase Migration Pattern

When you already have cross-stack references in production and need to remove them, a two-phase migration must be used.

### Recap

You have removed the cross-stack reference from the code and try to deploy:

1. CDK sees the reference is gone and tries to remove the export from the producing stack
2. CloudFormation blocks the removal because the consuming stack still imports it
3. The consuming stack hasn't deployed yet to remove its import
4. **Deadlock**: Neither stack can deploy

### Solution Phase 1: Create Dummy Exports

Keep the export alive temporarily using a "dummy export" while removing the reference from the consuming stack. For CDK versions 1.90.1 and later, use the `exportValue()` method:

```typescript
// Producing stack
export class UserServiceStack extends Stack {
  public readonly usersTable: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    ...

    // TEMPORARY: Create dummy export using exportValue
    this.exportValue(this.usersTable);
  }
}

// Stack 2 (Consuming): Remove the cross-stack reference
interface OrderServiceStackProps extends cdk.StackProps {
  usersTable: ITableV2;
}

export class OrderServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderServiceStackProps) {
    super(scope, id, props);

    const readUser = new NodejsFunction(this, "OrderFunction", {
      entry: "./lib/lambdas/handler.ts",
      environment: {
        ...
        // Remove this:
        //USER_TABLE: props.usersTable.tableName,
      },
    });

    // Remove this:
    //props.usersTable.grantReadData(readUser);
  }
}
```

**Steps:**

1. Run `cdk diff UserService` to identify the exact export name and logical ID
2. Add the dummy export with matching names
3. Deploy both stacks: `cdk deploy --all`
4. Verify the consuming stack no longer imports the value

### Phase 2: Remove Dummy Exports

After the consuming stack successfully deploys without the import:

```typescript
// Stack 1: Remove dummy export
export class UserServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new dynamodb.TableV2(this, 'UsersTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      tableName: 'Users'
    });

    // Dummy export removed
  }
}
```

### Drawbacks

- Requires careful coordination and multiple deployments
- Must inspect CloudFormation templates to get exact names
- Easy to make mistakes with export names and logical IDs

## References

1. [How to Resolve Tightly Coupled Dependencies in AWS CDK](https://superluminar.io/2025/10/16/how-to-resolve-tightly-coupled-dependencies-in-aws-cdk/) - Superluminar
2. [AWS CDK Stack Dependencies](https://blog.serverlessadvocate.com/aws-cdk-stack-dependencies-1d42a18aaec2) - Lee Gilmore
3. [CDK Tips #03: How to Unblock Cross-Stack References](https://www.endoflineblog.com/cdk-tips-03-how-to-unblock-cross-stack-references) - End of Line Blog
