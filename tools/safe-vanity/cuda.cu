#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifndef HOST_TEST
#include <cuda_runtime.h>
#define DEVICE __device__ __forceinline__
#define CONSTANT __device__ __constant__
#else
#define DEVICE inline
#define CONSTANT const
#endif

using Word = unsigned long long;
static_assert(sizeof(Word) == 8);
CONSTANT Word RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
    0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
    0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};
DEVICE Word rol(Word x, int n) { return (x << n) | (x >> (64 - n)); }
DEVICE void keccak(Word* s) {
    for (int round = 0; round < 24; ++round) {
        Word c[5];
        #pragma unroll
        for (int x = 0; x < 5; ++x) c[x] = s[x] ^ s[x+5] ^ s[x+10] ^ s[x+15] ^ s[x+20];
        #pragma unroll
        for (int x = 0; x < 5; ++x) {
            Word d = c[(x+4)%5] ^ rol(c[(x+1)%5], 1);
            #pragma unroll
            for (int y = 0; y < 25; y += 5) s[y+x] ^= d;
        }
        Word t = s[1];
        { Word next = s[10]; s[10] = rol(t, 1); t = next; }
        { Word next = s[7]; s[7] = rol(t, 3); t = next; }
        { Word next = s[11]; s[11] = rol(t, 6); t = next; }
        { Word next = s[17]; s[17] = rol(t, 10); t = next; }
        { Word next = s[18]; s[18] = rol(t, 15); t = next; }
        { Word next = s[3]; s[3] = rol(t, 21); t = next; }
        { Word next = s[5]; s[5] = rol(t, 28); t = next; }
        { Word next = s[16]; s[16] = rol(t, 36); t = next; }
        { Word next = s[8]; s[8] = rol(t, 45); t = next; }
        { Word next = s[21]; s[21] = rol(t, 55); t = next; }
        { Word next = s[24]; s[24] = rol(t, 2); t = next; }
        { Word next = s[4]; s[4] = rol(t, 14); t = next; }
        { Word next = s[15]; s[15] = rol(t, 27); t = next; }
        { Word next = s[23]; s[23] = rol(t, 41); t = next; }
        { Word next = s[19]; s[19] = rol(t, 56); t = next; }
        { Word next = s[13]; s[13] = rol(t, 8); t = next; }
        { Word next = s[12]; s[12] = rol(t, 25); t = next; }
        { Word next = s[2]; s[2] = rol(t, 43); t = next; }
        { Word next = s[20]; s[20] = rol(t, 62); t = next; }
        { Word next = s[14]; s[14] = rol(t, 18); t = next; }
        { Word next = s[22]; s[22] = rol(t, 39); t = next; }
        { Word next = s[9]; s[9] = rol(t, 61); t = next; }
        { Word next = s[6]; s[6] = rol(t, 20); t = next; }
        { Word next = s[1]; s[1] = rol(t, 44); t = next; }
        #pragma unroll
        for (int y = 0; y < 25; y += 5) {
            #pragma unroll
            for (int x = 0; x < 5; ++x) c[x] = s[y+x];
            #pragma unroll
            for (int x = 0; x < 5; ++x) s[y+x] = c[x] ^ ((~c[(x+1)%5]) & c[(x+2)%5]);
        }
        s[0] ^= RC[round];
    }
}
struct Inputs {
    Word salt[25];
    Word address[25];
    unsigned char prefix[16][40];
    int lengths[16];
    int targets;
};
struct Result { int found; Word nonce; unsigned char address[20]; };
DEVICE void predict(const Inputs& in, Word nonce, Word* address) {
    Word salt[25];
    #pragma unroll
    for (int i = 0; i < 25; ++i) { salt[i] = in.salt[i]; address[i] = in.address[i]; }
    Word reversed = 0;
    #pragma unroll
    for (int i = 0; i < 8; ++i) reversed |= ((nonce >> (8*i)) & 255ULL) << (56-8*i);
    salt[7] = reversed;
    keccak(salt);
    #pragma unroll
    for (int i = 0; i < 32; ++i) address[(21+i)/8] |= ((salt[i/8] >> (8*(i%8))) & 255ULL) << (8*((21+i)%8));
    keccak(address);
}
DEVICE unsigned char byte(const Word* s, int i) { return (s[i/8] >> (8*(i%8))) & 255; }
DEVICE void candidate(const Inputs& in, Word nonce, Result* results) {
    Word address[25];
    predict(in, nonce, address);
    for (int target = 0; target < in.targets; ++target) {
        bool match = true;
        for (int i = 0; i < in.lengths[target]; ++i) {
            auto b = byte(address, 12+i/2);
            if ((i%2 ? b & 15 : b >> 4) != in.prefix[target][i]) { match = false; break; }
        }
        if (match) {
#ifndef HOST_TEST
            if (atomicCAS(&results[target].found, 0, 1) != 0) continue;
#else
            if (results[target].found) continue;
            results[target].found = 1;
#endif
            results[target].nonce = nonce;
            for (int i = 0; i < 20; ++i) results[target].address[i] = byte(address, 12+i);
        }
    }
}
#ifndef HOST_TEST
CONSTANT Inputs inputs;
__global__ void mine(Word start, Word count, Result* results) {
    const Word stride = Word(gridDim.x) * blockDim.x;
    for (Word offset = Word(blockIdx.x)*blockDim.x + threadIdx.x; offset < count; offset += stride)
        candidate(inputs, start + offset, results);
}
void checked(cudaError_t status) {
    if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}
#endif
int nibble(char c) {
    if (c >= '0' && c <= '9') return c-'0';
    if (c >= 'a' && c <= 'f') return c-'a'+10;
    if (c >= 'A' && c <= 'F') return c-'A'+10;
    throw std::runtime_error("Invalid hex");
}
void put(Word* s, int at, unsigned char b) { s[at/8] |= Word(b) << (8*(at%8)); }
void insert(Word* s, int at, const std::string& hex, size_t length) {
    if (hex.size() != length*2) throw std::runtime_error("Invalid input length");
    for (size_t i = 0; i < length; ++i) put(s, at+i, nibble(hex[2*i])*16+nibble(hex[2*i+1]));
}
Word number(const std::string& s) {
    if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos) throw std::runtime_error("Invalid unsigned integer");
    return std::stoull(s);
}
int main(int argc, char** argv) {
    try {
        if (argc != 8) throw std::runtime_error("Expected initializerHash factory initCodeHash start count threads prefixes");
        Inputs in{};
        insert(in.salt, 0, argv[1], 32);
        put(in.salt, 64, 1); put(in.salt, 135, 128);
        put(in.address, 0, 255); insert(in.address, 1, argv[2], 20); insert(in.address, 53, argv[3], 32);
        put(in.address, 85, 1); put(in.address, 135, 128);
        const Word start = number(argv[4]), count = number(argv[5]);
        if (start > std::numeric_limits<Word>::max()-256 || count > std::numeric_limits<Word>::max()-start-256) throw std::runtime_error("Range overflow");
        std::stringstream prefixes(argv[7]);
        std::string prefix;
        while (std::getline(prefixes, prefix, ',')) {
            if (in.targets == 16 || prefix.empty() || prefix.size() > 40) throw std::runtime_error("Invalid prefixes (maximum 16)");
            in.lengths[in.targets] = prefix.size();
            for (size_t i = 0; i < prefix.size(); ++i) in.prefix[in.targets][i] = nibble(prefix[i]);
            ++in.targets;
        }
        if (!in.targets) throw std::runtime_error("No prefixes");
        Result results[16]{};
#ifdef HOST_TEST
        for (Word offset = 0; offset < count; ++offset) candidate(in, start+offset, results);
#else
        cudaDeviceProp prop;
        checked(cudaGetDeviceProperties(&prop, 0));
        checked(cudaMemcpyToSymbol(inputs, &in, sizeof(in)));
        Result* device_results = nullptr;
        checked(cudaMalloc(reinterpret_cast<void**>(&device_results), sizeof(results)));
        checked(cudaMemset(device_results, 0, sizeof(results)));
        mine<<<prop.multiProcessorCount*8, 128>>>(start, count, device_results);
        checked(cudaGetLastError());
        checked(cudaDeviceSynchronize());
        checked(cudaMemcpy(results, device_results, sizeof(results), cudaMemcpyDeviceToHost));
        checked(cudaFree(device_results));
#endif
        const char* hex = "0123456789abcdef";
        for (int t = 0; t < in.targets; ++t) if (results[t].found) {
            std::cout << t << ' ' << results[t].nonce << " 0x";
            for (auto b : results[t].address) std::cout << hex[b >> 4] << hex[b & 15];
            std::cout << '\n';
        }
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
