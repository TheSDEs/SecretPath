import { ethers } from "ethers";
import React, { useState, useEffect } from "react";
import {
  arrayify,
  hexlify,
  SigningKey,
  keccak256,
  recoverPublicKey,
  computeAddress,
} from "ethers/lib/utils";
import { ecdh, chacha20_poly1305_seal } from "@solar-republic/neutrino";
import {
  bytes,
  bytes_to_base64,
  json_to_bytes,
  sha256,
  concat,
  text_to_bytes,
  base64_to_bytes,
} from "@blake.regalia/belt";
import abi from "../abi.js";

const iface = new ethers.utils.Interface(abi);
const routing_contract = process.env.REACT_APP_SECRET_ADDRESS;
const routing_code_hash = process.env.REACT_APP_CODE_HASH;

const provider = new ethers.providers.Web3Provider(window.ethereum, "any");

const [myAddress] = await provider.send("eth_requestAccounts", []);

const wallet = ethers.Wallet.createRandom();
const userPrivateKeyBytes = arrayify(wallet.privateKey);
const userPublicKey = new SigningKey(wallet.privateKey).compressedPublicKey;
const userPublicKeyBytes = arrayify(userPublicKey);
const gatewayPublicKey = "A20KrD7xDmkFXpNMqJn1CLpRaDLcdKpO1NdBBS7VpWh3";
const gatewayPublicKeyBytes = base64_to_bytes(gatewayPublicKey);

const sharedKey = await sha256(
  ecdh(userPrivateKeyBytes, gatewayPublicKeyBytes)
);

const callbackSelector = iface.getSighash(iface.getFunction("upgradeHandler"));
const callbackGasLimit = 300000;

function CreateAuctionItem() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("");
  const [chainId, setChainId] = useState("");

  useEffect(() => {
    const handleChainChanged = (_chainId) => {
      // Convert _chainId to a number since it's usually hexadecimal
      const numericChainId = parseInt(_chainId, 16);
      setChainId(numericChainId.toString());
      console.log("Network changed to chain ID:", numericChainId);
    };

    window.ethereum.on("chainChanged", handleChainChanged);

    // Fetch initial chain ID
    const fetchChainId = async () => {
      const { chainId } = await provider.getNetwork();
      setChainId(chainId.toString());
      console.log("Current Chain ID:", chainId);
    };

    fetchChainId();

    // Cleanup function to remove listener
    return () => {
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  // useEffect(() => {
  //   let get_network = async () => {
  //     const network = (await provider.getNetwork()).chainId;
  //     setChainId(network);
  //     console.log(chainId);
  //   };
  //   get_network();
  // }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Create the data object from form state
    const data = JSON.stringify({
      name: name,
      description: description,
      end_time: minutes,
    });

    // let publicClientAddress = "0x3879E146140b627a5C858a08e507B171D9E43139";
    let publicClientAddress;
    let publicClientAddressSepolia =
      "0x3879E146140b627a5C858a08e507B171D9E43139";
    let publicClientAddressScrollSepolia =
      "0x4c14a6A0CD2DA2848D3C31285B828F6364087735";

    if (chainId === "11155111") {
      publicClientAddress = publicClientAddressSepolia;
    } else if (chainId === "534351") {
      publicClientAddress = publicClientAddressScrollSepolia;
    }

    const callbackAddress = publicClientAddress.toLowerCase();
    console.log(data);
    console.log(callbackAddress);

    // Payload construction
    const payload = {
      data: data,
      routing_info: routing_contract,
      routing_code_hash: routing_code_hash,
      user_address: myAddress,
      user_key: bytes_to_base64(userPublicKeyBytes),
      callback_address: bytes_to_base64(arrayify(callbackAddress)),
      callback_selector: bytes_to_base64(arrayify(callbackSelector)),
      callback_gas_limit: callbackGasLimit,
    };

    const payloadJson = JSON.stringify(payload);
    const plaintext = json_to_bytes(payload);
    const nonce = crypto.getRandomValues(bytes(12));

    const [ciphertextClient, tagClient] = chacha20_poly1305_seal(
      sharedKey,
      nonce,
      plaintext
    );
    const ciphertext = concat([ciphertextClient, tagClient]);
    const ciphertextHash = keccak256(ciphertext);
    const payloadHash = keccak256(
      concat([
        text_to_bytes("\x19Ethereum Signed Message:\n32"),
        arrayify(ciphertextHash),
      ])
    );
    const msgParams = ciphertextHash;

    const params = [myAddress, msgParams];
    const method = "personal_sign";
    const payloadSignature = await provider.send(method, params);
    const user_pubkey = recoverPublicKey(payloadHash, payloadSignature);

    const _info = {
      user_key: hexlify(userPublicKeyBytes),
      user_pubkey: user_pubkey,
      routing_code_hash: routing_code_hash,
      task_destination_network: "pulsar-3",
      handle: "create_auction_item",
      nonce: hexlify(nonce),
      payload: hexlify(ciphertext),
      payload_signature: payloadSignature,
      callback_gas_limit: callbackGasLimit,
    };

    const functionData = iface.encodeFunctionData("send", [
      payloadHash,
      myAddress,
      routing_contract,
      _info,
    ]);

    const gasFee = await provider.getGasPrice();
    const amountOfGas = gasFee.mul(callbackGasLimit).mul(3).div(2);

    const tx_params = {
      gas: hexlify(150000),
      to: publicClientAddress,
      from: myAddress,
      value: hexlify(amountOfGas),
      data: functionData,
    };

    const txHash = await provider.send("eth_sendTransaction", [tx_params]);
    console.log(`Transaction Hash: ${txHash}`);
  };

  return (
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-white">Create Auction Item</div>
        <div className="border-4 rounded-lg p-4">
          <div>
            <label className="block text-sm font-medium leading-6 text-white">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item Name"
              required
              className="mt-2 block w-full rounded-md border-0 bg-white/5 py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium leading-6 text-white">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Item Description"
              required
              className="mt-2 block w-full rounded-md border-0 bg-white/5 py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
              rows="4"
            ></textarea>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium leading-6 text-white">
              Minutes
            </label>
            <input
              type="text"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="Auction Duration in Minutes"
              required
              className="mt-2 block w-full rounded-md border-0 bg-white/5 py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          className="mt-4 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Create Auction Item
        </button>
      </form>
    </div>
  );
}

export default CreateAuctionItem;
