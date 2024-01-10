import { fileURLToPath } from "url"
import path from "path"

const dirname = path.dirname(fileURLToPath(import.meta.url))

export let deploy = {

  async start ({ cloudformation, stage }) {

    // defines a private bucket with loose acls for signed uploads
    cloudformation.Resources.PrivateBucket = {
      Type: 'AWS::S3::Bucket',
      DeletionPolicy: 'Delete',
      Properties: {
        /*
        OwnershipControls: {
          Rules: [{ObjectOwnership: "ObjectWriter"}] // allows direct upload to s3
        },*/
        WebsiteConfiguration: {
          IndexDocument: "index.html",
          ErrorDocument: "404.html"
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          BlockPublicPolicy: false,
          IgnorePublicAcls: false,
          RestrictPublicBuckets: false 
        }
      }
    }

    // this is required to make WebsiteConfig be accessible
    cloudformation.Resources.BucketPolicy = {
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: {
          Ref: 'PrivateBucket' 
        },
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Action: 's3:GetObject',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': ['',["arn:aws:s3:::",{Ref: 'PrivateBucket'},'/*']]
            },
            Principal: '*',
          }]
        }
      }
    }

    // adds /_content proxy to make assets appear to be same-origin
    cloudformation.Resources.HTTP.Properties.DefinitionBody.paths["/_content/{proxy+}"] = {
      get: {
        'x-amazon-apigateway-integration': {
          payloadFormatVersion: '1.0',
          type: 'http_proxy',
          httpMethod: "GET",
          uri: {
            //http://beginappstaging-privatebucket-1fmhvc535fslv.s3-website-us-west-2.amazonaws.com
            'Fn::Sub': [
              'http://${bukkit}.s3-website-${AWS::Region}.amazonaws.com/{proxy}',
              {bukkit: {Ref: 'PrivateBucket'}}
            ]
          },
          connectionType: "INTERNET",
          timeoutInMillis: 30000
        }
      }
    }

    // defines a Lambda function to process uploads
    let handler = path.join(dirname, '..', 'jobs', 'upload') 
    cloudformation.Resources.PrivateBucketLambda = {
      Type: "AWS::Serverless::Function",
      Properties: {
        Handler: "index.handler",
        CodeUri: handler,
        Runtime: "nodejs16.x",
        Architectures: [
          "x86_64"
        ],
        MemorySize: 1152,
        EphemeralStorage: {
          Size: 512
        },
        Timeout: 300,
        Role: {
          "Fn::Sub": [
            "arn:aws:iam::${AWS::AccountId}:role/${roleName}",
            {
              roleName: {
                Ref: "Role"
              }
            }
          ]
        },
        Environment: {
          Variables: {
            "ARC_ENV": stage,
            "ARC_STACK_NAME": {
              "Ref": "AWS::StackName"
            },
            "ARC_STATIC_BUCKET": {
              "Ref": "StaticBucket"
            }
          }
        },
        Policies: [{ 
          S3FullAccessPolicy: {
            BucketName: { Ref: 'PrivateBucket' }
          }
        }],
        Events: {
          PrivateBucketEvent: {
            Type: "S3",
            Properties: {
              Bucket: {Ref: 'PrivateBucket'},
              Events: 's3:ObjectCreated:*'
            }
          }
        }
      }
    }

    // give s3 permission to invoke the Lambda
    cloudformation.Resources.PrivateBucketLambdaPermission = {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Action: 'lambda:InvokeFunction',
        FunctionName: { Ref: 'PrivateBucketLambda' },
        Principal: 's3.amazonaws.com',
        SourceArn: {'Fn::GetAtt': ['PrivateBucket', 'Arn']},
        SourceAccount: {'Fn::Sub': '${AWS::AccountId}'}
      }
    }

    // ensure all Lambda functions in this stack can access the private bucket
    cloudformation.Resources.PrivateBucketPolicy = {
      Type: 'AWS::IAM::Policy',
      // DependsOn: 'PrivateBucketRole',
      Properties: {
        PolicyName: 'PrivateBucketPolicy',
        PolicyDocument: {
          Statement: [{
            Effect: 'Allow',
            Action: ['s3:*'],
            Resource: [{
              'Fn::Sub': [
                'arn:aws:s3:::${bucket}/*',
                { bucket: { Ref: 'PrivateBucket' } }
              ]
            }]
          }]
        },
        Roles: [ { 'Ref': 'Role' } ],
      }
    }

    // Add name to SSM params for runtime discovery
    cloudformation.Resources.PrivateBucketParam = {
      Type: 'AWS::SSM::Parameter',
      Properties: {
        Type: 'String',
        Name: {
          'Fn::Sub': ['/${AWS::StackName}/upload/bucket', {}]
        },
        Value: { Ref: 'PrivateBucket' }
      }
    }

    // console.log(JSON.stringify(cloudformation, null, 2))
    return cloudformation
  }
}
