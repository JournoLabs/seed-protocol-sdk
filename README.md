# [WIP] Seed Protocol SDK

This API is a work in progress. It is not yet ready for production use. These docs are for keeping the community informed
and generating feedback.

## Current research questions

- Can we use TypeORM backed by Sqlite Wasm for more performant and future-proof storage?
  - Track this research here: [TypeORM Sqlite Wasm](https://github.com/JournoDAO/typeorm-sqlite-wasm)
- What would the tooling look like to allow export of data model as ProtoBuf and/or JSON Schema?
  - Looking at [ts-proto](https://github.com/stephenh/ts-proto) for Typescript 

## Installing

This package is not yet published to npm, but when it is, this will be the command to install it:

```bash
yarn add @seedprotocol/sdk
```

## Getting Started

The first thing to do when integrating Seed SDK is define you data model. 

For example, let's pretend we're creating a blog that uses Seed Protocol as its content store. We start by defining our `Models`, their `Properties`, and what type of data each `Property` is expecting.

```typescript=
import {Model, Property, List, createStore} from '@seedprotocol/sdk'


const Image = Model({
      storageTransactionId: Property.String(),
      uri: Property.String(),
      alt: Property.String(),
    },)

const Link = Model({
  url: Property.String(),
  text: Property.String(),
},)

const Identity = Model({
  name: Property.String(),
  bio: Property.String(),
  avatarImage: Image,
},)

const Post = Model({
  title: Property.String(),
  summary: Property.String(),
  featureImage: Image,
  html: Property.String(),
  json: Property.String(),
  authors: Property.List(Identity,),
},)

createStore({
  Identity,
  Image,
  Link,
  Post,
},)
```

This will create a database locally in the browser with all the tables and fields necessary to support your Models. Feel free to check it out for yourself in your browser's Dev Tools.

Notice that we create relationships by defining a `Property` that takes its related Model as its type. For one-to-many relationships, we use the `List` type and pass in the `Model` type we want.

So creating a Post would look like this:

```typescript=
import {Post, Image, Identity} from './seed/models'
import html from './index.html'

const image = await Image.create({
    src: 'https://imgr.com/image.jpg',
})

const author = await Identity.create({
    name: 'Keith Axline',
    profile: 'Developer for Seed Protocol',
})

const authors = [
    author
]

const post = await Post.create({
    title: 'Some title',
    summary: 'My summary',
    featureImage: image,
    authors,
})

await post.publish()

// And later when we want to update the post
post.title = 'Something else'

await post.publish()

```
