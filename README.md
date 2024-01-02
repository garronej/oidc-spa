<p align="center">
    <img src="https://github.com/garronej/oidc-spa/assets/6702424/6adde1f7-b7b6-4b1a-b48f-bd02095b99ea">  
</p>
<p align="center">
    <i>Openidconnect client for Single Page Applications</i>
    <br>
    <br>
    <a href="https://github.com/garronej/oidc-spa/actions">
      <img src="https://github.com/garronej/oidc-spa/actions/workflows/ci.yaml/badge.svg?branch=main">
    </a>
    <a href="https://bundlephobia.com/package/oidc-spa">
      <img src="https://img.shields.io/bundlephobia/minzip/oidc-spa">
    </a>
    <a href="https://www.npmjs.com/package/oidc-spa">
      <img src="https://img.shields.io/npm/dw/oidc-spa">
    </a>
    <a href="https://github.com/garronej/oidc-spa/blob/main/LICENSE">
      <img src="https://img.shields.io/npm/l/oidc-spa">
    </a>
</p>
<p align="center">
  <a href="https://github.com/garronej/oidc-spa">Home</a>
  -
  <a href="https://docs.oidc-spa.dev">Documentation</a>
</p>

An OIDC client designed for Single Page Applications, typically [Vite](https://vitejs.dev/) projects.  
This is a lib that you would use, for example, to integrate your app with Keycloak.  
oidc-spa aims at being **very easy to setup and use** even if you are not familiar with the OIDC protocol.

## Comparison with Existing Libraries

### [oidc-client-ts](https://github.com/authts/oidc-client-ts)

While `oidc-client-ts` serves as a comprehensive toolkit, our library aims to provide a simplified, ready-to-use adapter that will pass
any security audit and that will just work out of the box on any browser.  
We utilize `oidc-client-ts` internally but abstract away most of its intricacies.

### [react-oidc-context](https://github.com/authts/react-oidc-context)

Our library takes a modular approach to OIDC and React, treating them as separate concerns that don't necessarily have to be intertwined.  
At it's core, oidc-spa is a simple adapter that is not tie to any particular UI framework and is a good fit for projects
that implement strict separation of concern between the core logic of the app and the UI.  
However we also provide adapters for React and starter project for integrating with react-router-dom or @tanstack/react-router.

### [keycloak-js](https://www.npmjs.com/package/keycloak-js)

Beside the fact that this lib only works with Keycloak [it is also likely to be deprecated or overhauled](https://www.keycloak.org/2023/03/adapter-deprecation-update), it's not type-safe, and hard to get working properly.

## 🚀 Quick start

Heads over to [the documentation website](https://docs.oidc-spa.dev) 📘!

## Showcases

This library is powers the authentication of the following platforms:

### Onyxia

-   [Source code](https://github.com/InseeFrLab/onyxia)
-   [Public instance](https://datalab.sspcloud.fr)

<a href="https://youtu.be/FvpNfVrxBFM">
  <img width="1712" alt="image" src="https://user-images.githubusercontent.com/6702424/231314534-2eeb1ab5-5460-4caa-b78d-55afd400c9fc.png">
</a>

### The French Interministerial Base of Free Software

-   [Source code](https://github.com/codegouvfr/sill-web/)
-   [Deployment of the website](https://sill-preprod.lab.sspcloud.fr/)

<a href="https://youtu.be/AT3CvmY_Y7M?si=Edkf0vRNjosGLA3R">
  <img width="1712" alt="image" src="https://github.com/garronej/i18nifty/assets/6702424/aa06cc30-b2bd-4c8b-b435-2f875f53175b">
</a>
