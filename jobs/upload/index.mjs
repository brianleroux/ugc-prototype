import awsLite from '@aws-lite/client'
import mime from 'mime-types'
import fs from 'node:fs'
import path from 'node:path'

export async function handler (event) {
  let aws = await awsLite()

  for (let r of event.Records) {
    let bail = r.s3.object.key.startsWith('fp') || r.s3.object.key.startsWith('raw')
    if (bail) {
      console.log('ignoring ', r.s3.object.key)
      continue;
    }

    let Bucket = r.s3.bucket.name
    let Key = r.s3.object.key
    let { Body, ETag } = await aws.s3.GetObject({Bucket, Key})
    let ContentType = getContentType(Key)
    let noCache = [ 'text/html', 'application/json' ]
    let cached = noCache.some(n => ContentType.includes(n)) === false
    let CacheControl = cached? 'max-age=315360000' : 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0'

    // get a hash of the contents
    let extn = Key.split('.').pop()
    let fingerprinted = `${ ETag }.${ extn }`
    let tmp = path.join('/tmp', fingerprinted)
    fs.writeFileSync(tmp, Body)

    // write fingerprinted
    console.log('write fingerprinted') 
    await aws.s3.PutObject({ 
      Bucket,
      Key: `fp/${fingerprinted}`,
      File: tmp,
      ContentType,
      CacheControl
    })
  
    // write the raw file w redirect meta
    console.log('write raw') 
    await aws.s3.PutObject({ 
      Bucket,
      Key: `raw/${Key}`,
      File: tmp,
      ContentType,
      WebsiteRedirectLocation: '/fp/' + fingerprinted
    })

    // remove the original file
    console.log('remove og', {Bucket, Key}) 
    let foo = await aws.s3.DeleteObject({
      Bucket,
      Key
    }) 
    console.log('done', foo)
  }
}

function getContentType (file) {
  let bits = file.split('.')
  let last = bits[bits.length - 1]
  if (last === 'tsx') return 'text/tsx'
  if (last === 'ts') return 'text/typescript'

  // Fall back to octet-stream if not found by mime-types lib
  return mime.lookup(last) || 'application/octet-stream'
}
